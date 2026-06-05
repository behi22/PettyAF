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

  // recentCalls from the in-memory ledger, enriched from the leads we just fetched
  const byLead = new Map(leads.map((l: any) => [l.id, l]));
  const recentCalls = ledger
    .all()
    .filter((e) => e.endedAt)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, 12)
    .map((e) => {
      const l: any = byLead.get(e.leadId);
      const cf = l?.customFields || {};
      return {
        callId: e.callId,
        caseId: e.leadId,
        debtorName: l?.fullName || '',
        personaKey: e.personaKey,
        amount: Number(cf.debt_amount || 0),
        status: cf.paf_status || e.outcome || 'OPEN',
        durationSec: e.durationSec || 0,
        endedAt: new Date(e.endedAt as number).toISOString(),
      };
    });

  return {
    kpis: {
      totalOutstanding: round2(totalOutstanding),
      totalCollected: round2(totalCollected),
      totalPromised: round2(totalPromised),
      callsMade: ledger.callsMade(),
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
