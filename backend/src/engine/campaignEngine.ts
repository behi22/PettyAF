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

// Emergency stop. Synchronous part runs before any await: kill flag + stop scheduling +
// stop relentless redials. In-flight pollers are KEPT so connected calls resolve to done
// on their own (no platform hangup API) and stop ticking once they actually end. Then,
// fire-and-forget, any DEPLOYED case is reverted to OPEN so it leaves "active" and lands
// in the archive (re-deployable).
export function stopAll(): void {
  globalStop = true;
  for (const s of states.values()) {
    s.stopped = true;
    s.runState = 'paused';
    if (s.tick) {
      clearInterval(s.tick);
      s.tick = null;
    }
    for (const f of s.inFlight.values()) liveRegistry.update(f.callId, { windingDown: true });
  }
  for (const t of redialTimers.values()) clearTimeout(t);
  redialTimers.clear();
  queuedInfo.clear();
  relentlessLeads.clear(); // emergency stop kills relentless for good (no auto-resume)
  console.log('[engine] EMERGENCY STOP: new dialing halted; relentless off; connected calls winding down');
  clearActiveStateOnStop().catch((e) => console.error('[engine] stop-clear failed', (e as Error).message));
}

// Clear "active" on emergency stop: any DEPLOYED lead goes back to OPEN, and relentless is
// disabled (persisted flag false) so cases leave the Active list and stop redialing. A call
// genuinely still connected overwrites paf_status with its real outcome when finishCall runs.
async function clearActiveStateOnStop(): Promise<void> {
  const leads = (await staging.listLeads('?source=PettyAF&limit=100')).items || [];
  for (const l of leads) {
    const cf = l.customFields || {};
    const wasDeployed = cf.paf_status === 'DEPLOYED';
    const wasRelentless = cf.relentless_enabled === true || cf.relentless_enabled === 'true';
    if (!wasDeployed && !wasRelentless) continue;
    await staging
      .patchLead(l.id, {
        customFields: { ...cf, paf_status: wasDeployed ? 'OPEN' : cf.paf_status, relentless_enabled: false },
      })
      .catch((e) => console.error('[engine] stop-clear patch failed', (e as Error).message));
  }
}

// Stop a single case's relentless loop (used when a case is settled/written off).
export function clearRelentless(leadId: string): void {
  relentlessLeads.delete(leadId);
  const t = redialTimers.get(leadId);
  if (t) {
    clearTimeout(t);
    redialTimers.delete(leadId);
  }
  queuedInfo.delete(leadId);
}

// Best-effort: pull whatever transcript staging has for a lead's latest phone call.
async function fetchTranscript(leadId: string): Promise<string | null> {
  try {
    const acts = await staging.getLeadActivities(leadId);
    const items: any[] = acts?.items ?? acts?.data ?? [];
    const phone = items
      .filter((a) => a.activityType === 'phone' && a.metadata?.transcript)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
    return phone?.metadata?.transcript || null;
  } catch {
    return null;
  }
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

// Stops scheduling new calls (the tick). Deliberately keeps in-flight pollers running so
// connected calls still resolve to done (the platform has no hangup API).
function clearTimers(s: EngineState): void {
  if (s.tick) {
    clearInterval(s.tick);
    s.tick = null;
  }
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

// Re-entrancy guard: a slow status request (up to httpTimeoutMs) can outlast the poll
// interval, so skip starting a new request for a call that already has one in flight.
const pollingNow = new Set<string>();
const MAX_CALL_MS = 5 * 60 * 1000; // safety net: force-finish a call that never reports ended

async function pollCall(s: EngineState, leadId: string, callId: string): Promise<void> {
  if (pollingNow.has(callId)) return;
  pollingNow.add(callId);
  try {
    const st = await getCallStatus(callId);
    if (!st) {
      // transient poll failure; force-finish only if the call has run absurdly long
      const start = ledger.get(callId)?.startedAt ?? Date.now();
      if (Date.now() - start > MAX_CALL_MS) {
        await finishCall(s, leadId, callId, { status: 'ended', endedReason: 'silence-timed-out' });
      }
      return;
    }
    const status = (st.status || '').toLowerCase();
    if (status === 'queued' || status === 'ringing') {
      liveRegistry.update(callId, { phase: 'dialing' });
      return;
    }
    if (status === 'in-progress') {
      liveRegistry.update(callId, { phase: 'talking' });
      // best-effort live transcript (usually only available once the call ends, but try)
      fetchTranscript(leadId)
        .then((t) => {
          if (t) liveRegistry.update(callId, { partialTranscript: t });
        })
        .catch(() => {});
      return;
    }
    if (status === 'ended' || status === 'completed' || status === 'failed' || st.endedReason) {
      await finishCall(s, leadId, callId, st);
    }
  } finally {
    pollingNow.delete(callId);
  }
}

async function finishCall(s: EngineState, leadId: string, callId: string, st: EngineStatus): Promise<void> {
  const f = s.inFlight.get(leadId);
  if (f) {
    clearInterval(f.pollTimer);
    s.inFlight.delete(leadId);
  }
  liveRegistry.update(callId, { phase: 'analyzing' });

  const start = ledger.get(callId)?.startedAt ?? Date.now();
  const durationSec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const rel = s.relentless.get(leadId) || { callCount: 0, consecutiveErrors: 0, halted: false };

  // Enrich from staging (best-effort). Classification falls back to endedReason alone.
  let newStatus: PafStatus = classifyStatus(st.endedReason, null);
  let transcript: string | null = null;
  try {
    const lead = await staging.getLead(leadId);
    newStatus = classifyStatus(st.endedReason, extractQual(lead));
    transcript = await fetchTranscript(leadId);
    const cf = (lead?.customFields as Record<string, unknown>) || {};
    // Rehydrate per-case relentless from the persisted flag so a redial still happens after
    // a backend restart wiped the in-memory set (the real cause of "doesn't call back").
    if (cf.relentless_enabled === true || cf.relentless_enabled === 'true') relentlessLeads.add(leadId);
    await staging
      .patchLead(leadId, {
        customFields: { ...cf, paf_status: newStatus, ever_completed_call: true, relentless_count: rel.callCount },
      })
      .catch((e) => console.error('[engine] patch on finish failed', (e as Error).message));
  } catch (e) {
    console.error('[engine] finishCall enrich error', (e as Error).message);
  }

  // ALWAYS record the ledger so the dashboard recent-calls populates even if enrich failed.
  ledger.complete(callId, { endedAt: Date.now(), durationSec, outcome: newStatus });
  liveRegistry.update(callId, { phase: 'done', durationSec, partialTranscript: transcript, windingDown: false });
  console.log(`[engine] call ${callId} ended (${st.endedReason || 'n/a'}) -> ${newStatus} ${durationSec}s`);

  if (st.endedReason === 'technical-error') rel.consecutiveErrors += 1;
  else rel.consecutiveErrors = 0;
  if (rel.consecutiveErrors >= 2) rel.halted = true;
  s.relentless.set(leadId, rel);

  dialState.set(leadId, 'idle');
  setTimeout(() => liveRegistry.remove(callId), 20000); // keep the completed call on the HUD a while

  // Campaign-mode relentless is driven by the tick loop. Per-case relentless (the FE toggle)
  // is driven here, since manual cases have no ticking campaign state.
  const wantPerCase = relentlessLeads.has(leadId);
  const softCapped = env.relentlessSoftCap > 0 && rel.callCount >= env.relentlessSoftCap;
  if (wantPerCase && !globalStop && !TERMINAL_STATUSES.includes(newStatus) && !rel.halted && !softCapped) {
    queuedInfo.set(leadId, { debtorName: '' });
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
