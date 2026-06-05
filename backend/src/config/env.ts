import 'dotenv/config';
import type { PersonaKey } from '../types';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}
function parsePersonaMap(raw: string | undefined): Partial<Record<PersonaKey, string>> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[env] PERSONA_AGENT_MAP is not valid JSON; defaulting to empty');
    return {};
  }
}

export const env = {
  port: num('PORT', 4000),
  staging: {
    apiUrl: req('STAGING_API_URL'),
    email: req('STAGING_EMAIL'),
    password: req('STAGING_PASSWORD'),
    orgId: process.env.STAGING_ORGANIZATION_ID || process.env.STAGING_ORG_ID || '',
    knowledgeBaseId: process.env.STAGING_KNOWLEDGE_BASE_ID || '',
  },
  personaAgentMap: parsePersonaMap(process.env.PERSONA_AGENT_MAP),
  engine: {
    url: process.env.VOICE_ENGINE_URL || 'https://voice.alebex.ai',
    apiKey: process.env.VOICE_ENGINE_API_KEY || '',
    // dev voice engine status polls can be slow; 10s was too tight and logged timeouts
    httpTimeoutMs: num('ENGINE_HTTP_TIMEOUT_MS', 20000),
  },
  webhookLeads: {
    url: process.env.WEBHOOK_LEADS_INGEST_URL || '',
    key: process.env.WEBHOOK_LEADS_API_KEY || process.env.WEBHOOK_LEADS_KEY || '',
  },
  // comma-separated list, so the local dev origin and the deployed Vercel origin both pass
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxConcurrentCalls: num('MAX_CONCURRENT_CALLS', 1),
  redialGapMs: num('REDIAL_GAP_MS', 8000),
  enginePollIntervalMs: num('ENGINE_POLL_INTERVAL_MS', 2000),
  analyzingTimeoutMs: num('ANALYZING_TIMEOUT_MS', 20000),
  relentlessSoftCap: num('RELENTLESS_SOFT_CAP', 50),
  // Hard safety rail: no real phone call is placed unless this is explicitly true.
  dialingEnabled: process.env.DIALING_ENABLED === 'true',
};

export function agentIdFor(persona: PersonaKey): string | undefined {
  const id = env.personaAgentMap[persona];
  return id && id.trim() ? id : undefined;
}
