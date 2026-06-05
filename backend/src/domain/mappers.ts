import { env, agentIdFor } from '../config/env';
import type { Campaign, CampaignRunState, CampaignSettings, Case, PafStatus, PersonaKey } from '../types';

// ---- Campaign settings <-> description blob ---------------------------------
// The staging Campaign entity has no custom fields, so PettyAF settings + purpose
// ride in `description`: "<purpose>\n\n__pettyaf__=<json>". Always written together.

const BLOB_KEY = '__pettyaf__=';

export function defaultSettings(): CampaignSettings {
  return {
    mode: 'standard',
    unhingedLevel: 5,
    defaultPersonaKey: 'child',
    maxConcurrentCalls: env.maxConcurrentCalls,
    endsAt: 0,
  };
}

export function serializeDescription(purpose: string, settings: CampaignSettings): string {
  return `${purpose}\n\n${BLOB_KEY}${JSON.stringify(settings)}`;
}

export function parseDescription(description: string | undefined): {
  purpose: string;
  settings: CampaignSettings;
} {
  const def = defaultSettings();
  if (!description) return { purpose: '', settings: def };
  const idx = description.lastIndexOf(BLOB_KEY);
  if (idx === -1) return { purpose: description.trim(), settings: def };
  const purpose = description.slice(0, idx).replace(/\n+$/, '');
  const json = description.slice(idx + BLOB_KEY.length).trim();
  try {
    return { purpose, settings: { ...def, ...JSON.parse(json) } };
  } catch {
    return { purpose, settings: def };
  }
}

export function campaignFromStaging(item: any, runState: CampaignRunState = 'draft'): Campaign {
  const { purpose, settings } = parseDescription(item?.description);
  const leadCount = item?.leadStats?.totalLeads ?? 0;
  return {
    id: item.id,
    name: item.name,
    purpose,
    runState,
    endsAt: settings.endsAt,
    settings,
    stats: {
      leadCount,
      callsMade: 0,
      promised: 0,
      settled: 0,
      collected: 0,
      outstanding: 0,
      liveNow: 0,
    },
  };
}

// ---- Case <-> staging lead --------------------------------------------------

export function caseNumber(id: string): string {
  const tail = (id || '').replace(/[^a-fA-F0-9]/g, '').slice(-4).toUpperCase().padStart(4, '0');
  return `PAF-2026-${tail}`;
}

export interface CreateCaseInput {
  debtorName: string;
  debtorPhone: string;
  amount: number;
  currency?: string;
  reason: string;
  sinceDate?: string;
  creditorName?: string;
  personaKey: PersonaKey;
  aggressionLevel?: number;
  knownWeaknesses?: string;
  settlementOptions?: string[];
  campaignId?: string;
  consentConfirmed?: boolean;
}

export interface LeadPayload {
  fullName: string;
  phone: string;
  source: string;
  agentId?: string;
  campaignId?: string;
  // Suppress the platform's auto-outreach scheduler (it auto-dials on lead creation,
  // trigger=lead_creation delay=0). PettyAF dials only via explicit deploy/test-call.
  blockCalls?: boolean;
  blockSms?: boolean;
  blockEmails?: boolean;
  customFields: Record<string, unknown>;
}

export function buildLeadPayload(
  input: CreateCaseInput,
  defaults?: { unhingedLevel?: number; personaKey?: PersonaKey },
): LeadPayload {
  const persona = input.personaKey || defaults?.personaKey || 'child';
  const aggression = input.aggressionLevel ?? defaults?.unhingedLevel ?? 5;
  return {
    fullName: input.debtorName,
    phone: input.debtorPhone,
    source: 'PettyAF',
    agentId: agentIdFor(persona), // REQUIRED for test-call; service validates presence
    campaignId: input.campaignId,
    blockCalls: true, // PettyAF controls dialing; never let the platform auto-dial
    blockSms: true,
    blockEmails: true,
    customFields: {
      debt_amount: input.amount,
      debt_currency: input.currency || 'CAD',
      debt_reason: input.reason,
      debt_since: input.sinceDate || '',
      creditor_name: input.creditorName || '',
      aggression_level: aggression,
      known_weaknesses: input.knownWeaknesses || '',
      settlement_options: (input.settlementOptions || []).join(', '),
      persona_key: persona,
      paf_status: 'OPEN',
      campaign_id: input.campaignId || '',
      consent_confirmed: input.consentConfirmed ?? false,
      ever_completed_call: false,
      relentless_count: 0,
    },
  };
}

export function leadToCase(lead: any): Case {
  const cf = lead?.customFields || {};
  const settlement =
    typeof cf.settlement_options === 'string'
      ? cf.settlement_options.split(',').map((s: string) => s.trim()).filter(Boolean)
      : Array.isArray(cf.settlement_options)
        ? cf.settlement_options
        : [];
  return {
    id: lead.id,
    caseNumber: caseNumber(lead.id),
    campaignId: lead.campaignId ?? cf.campaign_id ?? null,
    debtorName: lead.fullName ?? cf.debtor_name ?? '',
    debtorPhone: lead.phone ?? '',
    amount: Number(cf.debt_amount ?? 0),
    currency: cf.debt_currency ?? 'CAD',
    reason: cf.debt_reason ?? '',
    sinceDate: cf.debt_since || undefined,
    creditorName: cf.creditor_name || undefined,
    personaKey: (cf.persona_key ?? 'child') as PersonaKey,
    aggressionLevel: Number(cf.aggression_level ?? 5),
    knownWeaknesses: cf.known_weaknesses || undefined,
    settlementOptions: settlement,
    status: (cf.paf_status ?? 'OPEN') as PafStatus,
    relentless: {
      enabled: cf.relentless_enabled === true || cf.relentless_enabled === 'true',
      callCount: Number(cf.relentless_count ?? 0),
      active: false,
    },
    lastCall: null,
  };
}
