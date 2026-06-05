import { env, agentIdFor } from '../config/env';
import { staging } from '../clients/stagingClient';
import { ApiError } from '../middleware/error';
import {
  campaignFromStaging,
  defaultSettings,
  serializeDescription,
} from '../domain/mappers';
import {
  getRunState,
  liveCountForCampaign,
  pauseCampaign,
  startCampaign,
  updateCampaignSettings,
} from '../engine/campaignEngine';
import { ledger } from '../engine/ledger';
import { createCase, type CreateCaseBody } from './cases';
import type { Campaign, CampaignMode, CampaignSettings, PersonaKey } from '../types';

export interface CreateCampaignBody {
  name: string;
  purpose?: string;
  durationHours?: number;
  mode?: CampaignMode;
  unhingedLevel?: number;
  defaultPersonaKey?: PersonaKey;
  maxConcurrentCalls?: number;
}

function settingsFrom(body: Partial<CreateCampaignBody>, base?: CampaignSettings): CampaignSettings {
  const def = base ?? defaultSettings();
  return {
    mode: body.mode ?? def.mode,
    unhingedLevel: body.unhingedLevel ?? def.unhingedLevel,
    defaultPersonaKey: body.defaultPersonaKey ?? def.defaultPersonaKey,
    maxConcurrentCalls: body.maxConcurrentCalls ?? def.maxConcurrentCalls,
    endsAt:
      typeof body.durationHours === 'number'
        ? Date.now() + body.durationHours * 3600 * 1000
        : def.endsAt,
  };
}

export async function createCampaign(body: CreateCampaignBody): Promise<Campaign> {
  if (!env.staging.knowledgeBaseId) {
    throw new ApiError('STAGING_KNOWLEDGE_BASE_ID is not configured; cannot create a campaign', 500);
  }
  if (!body.name) throw new ApiError('name is required', 400);

  const settings = settingsFrom(body);
  const purpose = body.purpose || '';
  const agentId = agentIdFor(settings.defaultPersonaKey);

  const created = await staging.createCampaign({
    name: body.name,
    description: serializeDescription(purpose, settings),
    knowledgeBaseId: env.staging.knowledgeBaseId,
    agentIds: agentId ? [agentId] : [],
  });
  return campaignFromStaging(created, 'draft');
}

export async function listCampaigns(): Promise<Campaign[]> {
  const res = await staging.listCampaigns();
  return (res.items || []).map((item) => withRuntimeStats(campaignFromStaging(item, getRunState(item.id))));
}

export async function getCampaign(id: string): Promise<Campaign> {
  // No GET /campaigns/:id on staging -> fetch the list and filter.
  const res = await staging.listCampaigns();
  const item = (res.items || []).find((c) => c.id === id);
  if (!item) throw new ApiError('Campaign not found', 404);
  const campaign = withRuntimeStats(campaignFromStaging(item, getRunState(id)));

  // Enrich money stats from the campaign's leads.
  try {
    const leads = (await staging.listLeads(`?source=PettyAF&campaignId=${id}&limit=100`)).items || [];
    const money = aggregateMoney(leads);
    campaign.stats = { ...campaign.stats!, ...money, leadCount: leads.length };
  } catch {
    /* keep base stats */
  }
  return campaign;
}

export async function updateCampaign(id: string, body: Partial<CreateCampaignBody>): Promise<Campaign> {
  const res = await staging.listCampaigns();
  const item = (res.items || []).find((c) => c.id === id);
  if (!item) throw new ApiError('Campaign not found', 404);

  const current = campaignFromStaging(item, getRunState(id));
  const settings = settingsFrom(body, current.settings);
  const name = body.name ?? current.name;
  const purpose = body.purpose ?? current.purpose;
  const agentId = agentIdFor(settings.defaultPersonaKey);

  const updated = await staging.updateCampaign(id, {
    name,
    description: serializeDescription(purpose, settings),
    knowledgeBaseId: env.staging.knowledgeBaseId,
    agentIds: agentId ? [agentId] : [],
  });
  updateCampaignSettings(id, settings); // a running engine picks up changes next tick
  return withRuntimeStats(campaignFromStaging(updated, getRunState(id)));
}

export async function addLeads(campaignId: string, leads: CreateCaseBody[]): Promise<unknown[]> {
  const res = await staging.listCampaigns();
  const item = (res.items || []).find((c) => c.id === campaignId);
  if (!item) throw new ApiError('Campaign not found', 404);
  const { settings } = campaignDefaults(item);

  const out: unknown[] = [];
  for (const lead of leads) {
    out.push(
      await createCase({
        ...lead,
        campaignId,
        personaKey: lead.personaKey || settings.defaultPersonaKey,
        aggressionLevel: lead.aggressionLevel ?? settings.unhingedLevel,
      }),
    );
  }
  return out;
}

export async function start(id: string): Promise<{ runState: string; dialingEnabled: boolean }> {
  const res = await staging.listCampaigns();
  const item = (res.items || []).find((c) => c.id === id);
  if (!item) throw new ApiError('Campaign not found', 404);
  const { settings } = campaignDefaults(item);
  const runState = startCampaign(id, settings);
  return { runState, dialingEnabled: env.dialingEnabled };
}

export function pause(id: string): { runState: string } {
  pauseCampaign(id);
  return { runState: 'paused' };
}

export async function cancel(id: string): Promise<{ ok: true }> {
  pauseCampaign(id);
  await staging.deleteCampaign(id);
  return { ok: true };
}

// ---- helpers ----------------------------------------------------------------

function campaignDefaults(item: any): { settings: CampaignSettings } {
  const c = campaignFromStaging(item);
  return { settings: c.settings };
}

function withRuntimeStats(c: Campaign): Campaign {
  c.stats = {
    ...(c.stats ?? {
      leadCount: 0,
      promised: 0,
      settled: 0,
      collected: 0,
      outstanding: 0,
    }),
    callsMade: ledger.byCampaign(c.id).length,
    liveNow: liveCountForCampaign(c.id),
  } as Campaign['stats'];
  return c;
}

function aggregateMoney(leads: any[]) {
  let promised = 0,
    settled = 0,
    collected = 0,
    outstanding = 0;
  for (const l of leads) {
    const cf = l.customFields || {};
    const amount = Number(cf.debt_amount || 0);
    const status = cf.paf_status || 'OPEN';
    if (status === 'PROMISED') promised += amount;
    if (status === 'SETTLED') {
      settled += 1;
      collected += amount;
    }
    if (status !== 'SETTLED' && status !== 'WRITTEN_OFF') outstanding += amount;
  }
  return { promised, settled, collected, outstanding };
}
