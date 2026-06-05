import { env } from '../config/env';
import { staging } from '../clients/stagingClient';
import { getCallStatus, type EngineStatus } from '../clients/engineClient';
import { liveRegistry } from './liveRegistry';
import { ledger } from './ledger';
import { classifyStatus, DIALABLE_STATUSES, TERMINAL_STATUSES } from '../domain/status';
import { caseNumber, defaultSettings } from '../domain/mappers';
import type { CampaignRunState, CampaignSettings, PafStatus, PersonaKey, QualAnswers } from '../types';

type DialState = 'idle' | 'reserved' | 'dialing' | 'live';

interface RelInfo {
  callCount: number;
  consecutiveErrors: number;
  halted: boolean; // gate-400 or 2 consecutive errors -> excluded from further dialing
}

interface EngineState {
  campaignId: string;
  runState: CampaignRunState;
  stopped: boolean;
  mode: CampaignSettings['mode'];
  unhingedLevel: number;
  defaultPersonaKey: PersonaKey;
  maxConcurrentCalls: number;
  endsAt: number;
  inFlight: Map<string, { callId: string; pollTimer: NodeJS.Timeout }>; // by leadId
  relentless: Map<string, RelInfo>; // by leadId
  lastAttemptAt: Map<string, number>; // by leadId
  tick: NodeJS.Timeout | null;
}

const TICK_MS = 1000;
const STANDARD_RETRY_CAP = 3;

const states = new Map<string, EngineState>();
const dialState = new Map<string, DialState>(); // global, by leadId
let globalStop = false;

// Per-case relentless (the FE's per-case toggle, main.md 7.5), independent of campaign mode.
const relentlessLeads = new Set<string>();
const redialTimers = new Map<string, NodeJS.Timeout>();
const queuedInfo = new Map<string, { debtorName: string }>();

// ---- public API -------------------------------------------------------------

export function isDialingEnabled(): boolean {
  return env.dialingEnabled;
}

export function isStopped(): boolean {
  return globalStop;
}

export function getQueued(): Array<{ caseId: string; debtorName: string; state: string }> {
  return [...queuedInfo.entries()].map(([caseId, v]) => ({
    caseId,
    debtorName: v.debtorName,
    state: 'RELENTLESS QUEUE',
  }));
}

// Per-case relentless toggle (FE LiveCalls). Mirrors to customFields so getCase reflects it.
export async function setCaseRelentless(leadId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  if (enabled) {
    globalStop = false;
    relentlessLeads.add(leadId);
  } else {
    relentlessLeads.delete(leadId);
    const t = redialTimers.get(leadId);
    if (t) {
      clearTimeout(t);
      redialTimers.delete(leadId);
    }
    queuedInfo.delete(leadId);
  }
  try {
    const lead = await staging.getLead(leadId);
    const cf = lead.customFields || {};
    await staging.patchLead(leadId, { customFields: { ...cf, relentless_enabled: enabled } });
  } catch (e) {
    console.error('[engine] setCaseRelentless patch failed', (e as Error).message);
  }
  return { enabled };
}

export function getRunState(campaignId: string): CampaignRunState {
  return states.get(campaignId)?.runState ?? 'draft';
}

export function liveCountForCampaign(campaignId: string): number {
  return states.get(campaignId)?.inFlight.size ?? 0;
}

export function startCampaign(campaignId: string, settings: CampaignSettings): CampaignRunState {
  globalStop = false;
  let s = states.get(campaignId);
  if (!s) {
    s = makeState(campaignId, settings);
    states.set(campaignId, s);
  } else {
    Object.assign(s, {
      runState: 'active' as CampaignRunState,
      stopped: false,
      mode: settings.mode,
      unhingedLevel: settings.unhingedLevel,
      defaultPersonaKey: settings.defaultPersonaKey,
      maxConcurrentCalls: settings.maxConcurrentCalls,
      endsAt: settings.endsAt,
    });
  }
  s.runState = 'active';
  s.stopped = false;
  if (!s.tick) {
    s.tick = setInterval(() => {
      tick(s!).catch((e) => console.error('[engine] tick error', e));
    }, TICK_MS);
  }
  console.log(`[engine] campaign ${campaignId} started mode=${s.mode} dialingEnabled=${env.dialingEnabled}`);
  return s.runState;
}

export function updateCampaignSettings(campaignId: string, settings: Partial<CampaignSettings>): void {
  const s = states.get(campaignId);
  if (!s) return;
  if (settings.mode) s.mode = settings.mode;
  if (typeof settings.unhingedLevel === 'number') s.unhingedLevel = settings.unhingedLevel;
  if (settings.defaultPersonaKey) s.defaultPersonaKey = settings.defaultPersonaKey;
  if (typeof settings.maxConcurrentCalls === 'number') s.maxConcurrentCalls = settings.maxConcurrentCalls;
  if (typeof settings.endsAt === 'number') s.endsAt = settings.endsAt;
}

export function pauseCampaign(campaignId: string): void {
  const s = states.get(campaignId);
  if (!s) return;
  s.stopped = true;
  s.runState = 'paused';
  clearTimers(s);
  console.log(`[engine] campaign ${campaignId} paused`);
}

// Emergency stop. Synchronous: sets the kill flag before any await, then clears
// every timer. No new call is placed after this. Connected calls cannot be
// force-terminated by the platform; they end on their own.
export function stopAll(): void {
  globalStop = true;
  for (const s of states.values()) {
    s.stopped = true;
    s.runState = 'paused';
    clearTimers(s);
  }
  for (const t of redialTimers.values()) clearTimeout(t);
  redialTimers.clear();
  queuedInfo.clear();
  console.log('[engine] EMERGENCY STOP: all campaigns halted');
}

// Single-case deploy for the main.md demo spine (POST /api/cases/:id/deploy).
export async function manualDeploy(leadId: string): Promise<string | undefined> {
  globalStop = false; // an explicit deploy is intent to dial; lift any prior emergency stop
  const lead = await staging.getLead(leadId);
  const campaignId = lead.campaignId || 'manual';
  let s = states.get(campaignId);
  if (!s) {
    s = makeState(campaignId, defaultSettings());
    states.set(campaignId, s);
  }
  await deploy(s, lead);
  return s.inFlight.get(leadId)?.callId;
}

// ---- internals --------------------------------------------------------------

function makeState(campaignId: string, settings: CampaignSettings): EngineState {
  return {
    campaignId,
    runState: 'active',
    stopped: false,
    mode: settings.mode,
    unhingedLevel: settings.unhingedLevel,
    defaultPersonaKey: settings.defaultPersonaKey,
    maxConcurrentCalls: settings.maxConcurrentCalls,
    endsAt: settings.endsAt,
    inFlight: new Map(),
    relentless: new Map(),
    lastAttemptAt: new Map(),
    tick: null,
  };
}

function clearTimers(s: EngineState): void {
  if (s.tick) {
    clearInterval(s.tick);
    s.tick = null;
  }
  for (const f of s.inFlight.values()) clearInterval(f.pollTimer);
}

function complete(s: EngineState): void {
  s.runState = 'completed';
  s.stopped = true;
  clearTimers(s);
  console.log(`[engine] campaign ${s.campaignId} completed`);
}

function concurrencyCap(s: EngineState): number {
  return Math.min(s.maxConcurrentCalls || 1, env.maxConcurrentCalls);
}

async function tick(s: EngineState): Promise<void> {
  if (globalStop || s.stopped || s.runState !== 'active') return;
  if (s.endsAt && Date.now() > s.endsAt) {
    complete(s);
    return;
  }
  if (s.inFlight.size >= concurrencyCap(s)) return;

  let leads: any[];
  try {
    const res = await staging.listLeads(`?source=PettyAF&campaignId=${s.campaignId}&limit=100`);
    leads = res.items || [];
  } catch (e) {
    console.error('[engine] listLeads failed', (e as Error).message);
    return;
  }

  // re-check after the await
  if (globalStop || s.stopped || s.runState !== 'active') return;
  if (s.inFlight.size >= concurrencyCap(s)) return;

  const now = Date.now();
  const eligible = leads.filter((l) => isEligible(s, l, now));

  if (eligible.length === 0) {
    if (s.inFlight.size === 0) {
      const anyNonTerminal = leads.some(
        (l) => !TERMINAL_STATUSES.includes((l.customFields?.paf_status || 'OPEN') as PafStatus),
      );
      if (!anyNonTerminal) complete(s);
    }
    return;
  }

  eligible.sort((a, b) => (s.lastAttemptAt.get(a.id) || 0) - (s.lastAttemptAt.get(b.id) || 0));
  await deploy(s, eligible[0]);
}

function isEligible(s: EngineState, lead: any, now: number): boolean {
  const cf = lead.customFields || {};
  const status = (cf.paf_status || 'OPEN') as PafStatus;
  if ((dialState.get(lead.id) || 'idle') !== 'idle') return false;
  if (!DIALABLE_STATUSES.includes(status)) return false;
  if (now - (s.lastAttemptAt.get(lead.id) || 0) < env.redialGapMs) return false;

  const rel = s.relentless.get(lead.id);
  if (s.mode === 'standard') {
    if (status === 'DISPUTED') return false; // had a conversation; do not badger
    if (rel && rel.callCount >= STANDARD_RETRY_CAP) return false;
  } else {
    if (rel?.halted) return false;
    if (env.relentlessSoftCap > 0 && rel && rel.callCount >= env.relentlessSoftCap) return false;
  }
  return true;
}

async function deploy(s: EngineState, lead: any): Promise<void> {
  const leadId = lead.id;

  // 1. synchronous reservation + stop checks (closes the across-await double-dial window)
  if (globalStop || s.stopped) return;
  if ((dialState.get(leadId) || 'idle') !== 'idle') return;
  dialState.set(leadId, 'reserved');
  s.lastAttemptAt.set(leadId, Date.now());

  const cf = lead.customFields || {};
  const persona = (cf.persona_key || s.defaultPersonaKey) as PersonaKey;
  const phone = lead.phone;

  try {
    // 2. reset the native outreach gate + mark DEPLOYED BEFORE dialing
    await staging.patchLead(leadId, {
      status: 'contacted',
      customFields: { ...cf, paf_status: 'DEPLOYED' },
    });

    // 3. final synchronous stop re-check, right before firing
    if (globalStop || s.stopped) {
      dialState.set(leadId, 'idle');
      return;
    }

    // SAFETY RAIL: never place a real call unless explicitly enabled.
    if (!env.dialingEnabled) {
      console.warn(`[engine] DIALING_ENABLED=false; NOT calling ${phone} for lead ${leadId} (gate reset + DEPLOYED applied)`);
      dialState.set(leadId, 'idle');
      return;
    }

    // 4. fire
    const resp = await staging.testCall(leadId, phone);
    const callId = resp?.callId || resp?.data?.callId || resp?.id;
    if (!callId) throw new Error('test-call returned no callId');

    dialState.set(leadId, 'live');
    const rel = s.relentless.get(leadId) || { callCount: 0, consecutiveErrors: 0, halted: false };
    rel.callCount += 1;
    s.relentless.set(leadId, rel);

    liveRegistry.upsert({
      callId,
      caseId: leadId,
      campaignId: s.campaignId === 'manual' ? null : s.campaignId,
      caseNumber: caseNumber(leadId),
      debtorName: lead.fullName || '',
      personaKey: persona,
      amount: Number(cf.debt_amount || 0),
      currency: cf.debt_currency || 'CAD',
      phase: 'dialing',
      startedAt: new Date().toISOString(),
      durationSec: 0,
      callCount: rel.callCount,
      partialTranscript: null,
    });
    ledger.record({
      callId,
      campaignId: s.campaignId === 'manual' ? null : s.campaignId,
      leadId,
      personaKey: persona,
      startedAt: Date.now(),
    });

    const pollTimer = setInterval(() => {
      pollCall(s, leadId, callId).catch((e) => console.error('[engine] poll error', e));
    }, env.enginePollIntervalMs);
    s.inFlight.set(leadId, { callId, pollTimer });
    console.log(`[engine] deployed lead=${leadId} call=${callId} persona=${persona} #${rel.callCount}`);
  } catch (e) {
    const err = e as { message?: string; status?: number };
    const msg = err?.message || String(e);
    dialState.set(leadId, 'idle');
    if (/not eligible for outreach/i.test(msg) || (err?.status === 400 && /eligible/i.test(msg))) {
      console.warn(`[engine] lead ${leadId} not eligible for outreach; halting its relentless loop`);
      const rel = s.relentless.get(leadId) || { callCount: 0, consecutiveErrors: 0, halted: false };
      rel.halted = true;
      s.relentless.set(leadId, rel);
    } else {
      console.error(`[engine] deploy failed lead=${leadId}: ${msg}`);
    }
  }
}

async function pollCall(s: EngineState, leadId: string, callId: string): Promise<void> {
  const st = await getCallStatus(callId);
  if (!st) return; // transient; retry next interval
  const status = (st.status || '').toLowerCase();
  if (status === 'queued' || status === 'ringing') {
    liveRegistry.update(callId, { phase: 'dialing' });
    return;
  }
  if (status === 'in-progress') {
    liveRegistry.update(callId, { phase: 'talking' });
    return;
  }
  if (status === 'ended' || status === 'completed' || status === 'failed' || st.endedReason) {
    await finishCall(s, leadId, callId, st);
  }
}

async function finishCall(s: EngineState, leadId: string, callId: string, st: EngineStatus): Promise<void> {
  const f = s.inFlight.get(leadId);
  if (f) {
    clearInterval(f.pollTimer);
    s.inFlight.delete(leadId);
  }
  liveRegistry.update(callId, { phase: 'analyzing' });

  try {
    const lead = await staging.getLead(leadId).catch(() => null);
    const qual = lead ? extractQual(lead) : null;
    const newStatus = classifyStatus(st.endedReason, qual);
    const cf = (lead?.customFields as Record<string, unknown>) || {};
    const rel = s.relentless.get(leadId) || { callCount: 0, consecutiveErrors: 0, halted: false };

    await staging
      .patchLead(leadId, {
        customFields: {
          ...cf,
          paf_status: newStatus,
          ever_completed_call: true,
          relentless_count: rel.callCount,
        },
      })
      .catch((e) => console.error('[engine] patch on finish failed', (e as Error).message));

    const start = ledger.get(callId)?.startedAt ?? Date.now();
    ledger.complete(callId, { endedAt: Date.now(), durationSec: Math.floor((Date.now() - start) / 1000), outcome: newStatus });
    liveRegistry.update(callId, { phase: 'done', partialTranscript: st.transcript || null });
    console.log(`[engine] call ${callId} ended (${st.endedReason || 'n/a'}) -> ${newStatus}`);

    if (st.endedReason === 'technical-error') rel.consecutiveErrors += 1;
    else rel.consecutiveErrors = 0;
    if (rel.consecutiveErrors >= 2) rel.halted = true;
    s.relentless.set(leadId, rel);

    dialState.set(leadId, 'idle');
    setTimeout(() => liveRegistry.remove(callId), 5000); // let the FE see 'done' briefly

    // Campaign-mode relentless is driven by the tick loop. Per-case relentless (the FE
    // toggle) is driven here, since manual cases have no ticking campaign state.
    const wantPerCase = relentlessLeads.has(leadId);
    const softCapped = env.relentlessSoftCap > 0 && rel.callCount >= env.relentlessSoftCap;
    if (wantPerCase && !globalStop && !TERMINAL_STATUSES.includes(newStatus) && !rel.halted && !softCapped) {
      queuedInfo.set(leadId, { debtorName: (lead as any)?.fullName || '' });
      const t = setTimeout(() => {
        redialTimers.delete(leadId);
        queuedInfo.delete(leadId);
        if (globalStop || !relentlessLeads.has(leadId)) return;
        manualDeploy(leadId).catch((e) => console.error('[engine] relentless redial failed', e));
      }, env.redialGapMs);
      redialTimers.set(leadId, t);
    } else {
      queuedInfo.delete(leadId);
    }
  } catch (e) {
    console.error('[engine] finishCall error', (e as Error).message);
    dialState.set(leadId, 'idle');
  }
}

function extractQual(lead: any): QualAnswers | null {
  const qs = lead?.qualificationSummary;
  if (!qs || typeof qs !== 'object') return null;
  const rawAdmitted = qs.admitted_debt ?? qs.admittedDebt;
  const admittedDebt = toBool(rawAdmitted);
  return {
    admittedDebt,
    excuseGiven: qs.excuse_given ?? qs.excuseGiven,
    paymentCommitment: qs.payment_commitment ?? qs.paymentCommitment,
  };
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase().trim();
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return undefined;
}
