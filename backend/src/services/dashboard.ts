import { staging } from '../clients/stagingClient';
import { ledger } from '../engine/ledger';
import { liveRegistry } from '../engine/liveRegistry';
import type { PersonaKey } from '../types';

export interface DashboardKpis {
  totalOutstanding: number;
  totalCollected: number; // "money earned from victims" = SETTLED total
  totalPromised: number;
  callsMade: number;
  talkMinutes: number;
  activeCases: number;
  friendshipsAtRisk: number;
  ledgerOfShame: number;
  liveNow: number;
  successRate: number;
}

export interface Dashboard {
  kpis: DashboardKpis;
  byPersona: Array<{ personaKey: string; cases: number; promised: number; collected: number }>;
  recentCalls: Array<{
    callId: string;
    caseId: string;
    debtorName: string;
    personaKey: string;
    amount: number;
    status: string;
    durationSec: number;
    endedAt: string;
  }>;
}

const ACTIVE = new Set(['OPEN', 'DEPLOYED', 'DISPUTED', 'GHOSTED', 'VOICEMAIL']);
const ROSTER: PersonaKey[] = ['child', 'medieval', 'angry'];

export async function getDashboard(): Promise<Dashboard> {
  const leads = (await staging.listLeads('?source=PettyAF&limit=100')).items || [];

  let totalOutstanding = 0,
    totalCollected = 0,
    totalPromised = 0,
    activeCases = 0,
    friendshipsAtRisk = 0,
    ledgerOfShame = 0,
    completed = 0,
    succeeded = 0;

  // seed all three personas so the performance table always shows the roster
  const personas = new Map<string, { cases: number; promised: number; collected: number }>(
    ROSTER.map((p) => [p, { cases: 0, promised: 0, collected: 0 }]),
  );
  const pget = (k: string) => personas.get(k) || personas.set(k, { cases: 0, promised: 0, collected: 0 }).get(k)!;

  for (const l of leads) {
    const cf = l.customFields || {};
    const amount = Number(cf.debt_amount || 0);
    const status = cf.paf_status || 'OPEN';
    const persona = cf.persona_key || 'child';
    const p = pget(persona);
    p.cases += 1;
    ledgerOfShame += amount;

    if (status !== 'SETTLED' && status !== 'WRITTEN_OFF') totalOutstanding += amount;
    if (status === 'PROMISED') {
      totalPromised += amount;
      p.promised += 1;
    }
    if (status === 'SETTLED') {
      totalCollected += amount;
      p.collected += amount;
    }
    if (ACTIVE.has(status)) activeCases += 1;
    if (status === 'DEPLOYED' || status === 'DISPUTED') friendshipsAtRisk += 1;

    if (cf.ever_completed_call === true || cf.ever_completed_call === 'true') {
      completed += 1;
      if (status === 'PROMISED' || status === 'SETTLED') succeeded += 1;
    }
  }

  // recentCalls derived from staging leads (robust across backend restarts), newest first.
  // Per-call durations come from the in-memory ledger when available this session.
  const ledgerDur = new Map<string, number>();
  for (const e of ledger.all()) if (e.endedAt && e.durationSec != null) ledgerDur.set(e.leadId, e.durationSec);
  const recentCalls = leads
    .filter((l: any) => {
      const c = l.customFields || {};
      return c.ever_completed_call === true || c.ever_completed_call === 'true';
    })
    .sort(
      (a: any, b: any) =>
        Date.parse(b.lastContactDate || b.updatedAt || 0) - Date.parse(a.lastContactDate || a.updatedAt || 0),
    )
    .slice(0, 12)
    .map((l: any) => {
      const cf = l.customFields || {};
      return {
        callId: l.id,
        caseId: l.id,
        debtorName: l.fullName || '',
        personaKey: cf.persona_key || 'child',
        amount: Number(cf.debt_amount || 0),
        status: cf.paf_status || 'OPEN',
        durationSec: ledgerDur.get(l.id) || 0,
        endedAt: l.lastContactDate || l.updatedAt || new Date().toISOString(),
      };
    });

  // callsMade: prefer the exact session ledger; fall back to staging so it is never 0 when
  // completed calls exist (relentless_count is the per-lead attempt counter we patch on finish).
  const callsFromLeads = leads.reduce(
    (s: number, l: any) => s + Number((l.customFields || {}).relentless_count || 0),
    0,
  );
  const callsMade = Math.max(ledger.callsMade(), callsFromLeads, completed);

  return {
    kpis: {
      totalOutstanding: round2(totalOutstanding),
      totalCollected: round2(totalCollected),
      totalPromised: round2(totalPromised),
      callsMade,
      talkMinutes: Math.round(ledger.talkSeconds() / 60),
      activeCases,
      friendshipsAtRisk,
      ledgerOfShame: round2(ledgerOfShame),
      liveNow: liveRegistry.size(),
      successRate: completed ? round2(succeeded / completed) : 0,
    },
    byPersona: [...personas.entries()].map(([personaKey, v]) => ({
      personaKey,
      cases: v.cases,
      promised: v.promised,
      collected: round2(v.collected),
    })),
    recentCalls,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
