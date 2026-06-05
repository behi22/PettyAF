import { agentIdFor } from '../config/env';
import { staging } from '../clients/stagingClient';
import { ApiError } from '../middleware/error';
import { buildLeadPayload, leadToCase, type CreateCaseInput } from '../domain/mappers';
import type { Case, CallResult, PafStatus, QualAnswers } from '../types';

export type CreateCaseBody = CreateCaseInput;

export async function createCase(body: CreateCaseBody): Promise<Case> {
  if (!body.debtorName) throw new ApiError('debtorName is required', 400);
  if (!body.debtorPhone) throw new ApiError('debtorPhone is required (E.164)', 400);

  const persona = body.personaKey || 'child';
  const agentId = agentIdFor(persona);
  if (!agentId) {
    throw new ApiError(
      `Persona "${persona}" has no provisioned staging agent yet (PERSONA_AGENT_MAP). Dialing requires lead.agentId.`,
      400,
    );
  }

  const payload = buildLeadPayload(body);
  const created = await staging.createLead(payload);
  // Note: staging dedups by phone/email (reinquiry) and may return an EXISTING lead.
  return leadToCase(created);
}

export async function listCases(query = '?source=PettyAF&limit=100'): Promise<Case[]> {
  const res = await staging.listLeads(query);
  return (res.items || []).map(leadToCase);
}

export async function getCase(id: string): Promise<Case> {
  const lead = await staging.getLead(id);
  const c = leadToCase(lead);
  c.lastCall = await buildLastCall(id, lead).catch(() => null);
  return c;
}

// Assemble the latest call result from staging (the dev engine status carries no
// transcript/summary). Sources confirmed live:
//   summary      -> lead.aiSummary
//   transcript   -> activities[].metadata.transcript (phone activity)
//   recording    -> activity.callLog.recordingUrl (or metadata.recordingUrl)
//   qualAnswers  -> lead.qualificationSummary
export async function buildLastCall(leadId: string, lead?: any): Promise<CallResult | null> {
  const detail = lead ?? (await staging.getLead(leadId));
  const acts = await staging.getLeadActivities(leadId);
  const items: any[] = acts?.items ?? acts?.data ?? [];
  const phone = items
    .filter((a) => a.activityType === 'phone' && (a.metadata?.transcript || a.callLog))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];

  if (!phone && !detail?.aiSummary) return null;
  const log = phone?.callLog || {};
  const meta = phone?.metadata || {};
  return {
    callId: log.externalCallId || log.id || 'unknown',
    endedReason: log.outcome || meta.endedReason,
    durationSec: log.durationSeconds ?? meta.duration,
    transcript: meta.transcript || log.transcript,
    summary: detail?.aiSummary || log.summary,
    sentiment: log.sentiment,
    outcome: log.outcome,
    recordingUrl: log.recordingUrl || meta.recordingUrl,
    qualAnswers: extractQual(detail),
  };
}

function extractQual(lead: any): QualAnswers | null {
  const qs = lead?.qualificationSummary;
  if (!qs || typeof qs !== 'object' || Object.keys(qs).length === 0) return null;
  const admitted = qs.admitted_debt ?? qs.admittedDebt;
  const toBool = (v: unknown): boolean | undefined => {
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase().trim();
    return s === 'yes' || s === 'true' ? true : s === 'no' || s === 'false' ? false : undefined;
  };
  return {
    admittedDebt: toBool(admitted),
    excuseGiven: qs.excuse_given ?? qs.excuseGiven,
    paymentCommitment: qs.payment_commitment ?? qs.paymentCommitment,
  };
}

export async function patchStatus(id: string, status: PafStatus): Promise<Case> {
  const lead = await staging.getLead(id);
  const cf = lead.customFields || {};
  const updated = await staging.patchLead(id, { customFields: { ...cf, paf_status: status } });
  return leadToCase(updated?.id ? updated : { ...lead, customFields: { ...cf, paf_status: status } });
}
