import axios from 'axios';
import { env } from '../config/env';

export interface EngineStatus {
  status?: string; // queued | ringing | in-progress | ended | failed
  endedReason?: string;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  raw?: any;
}

/**
 * Poll the voice engine for a call's status. This is our PRIMARY result source:
 * the engine returns transcript/summary/recordingUrl/endedReason once the call ends.
 * Returns null on any transient failure so callers can simply retry on the next tick.
 */
export async function getCallStatus(callId: string): Promise<EngineStatus | null> {
  if (!env.engine.apiKey) {
    console.warn('[engine] VOICE_ENGINE_API_KEY not set; cannot poll call status');
    return null;
  }
  try {
    const res = await axios.get(`${env.engine.url}/call/status/${encodeURIComponent(callId)}`, {
      headers: { 'X-API-Key': env.engine.apiKey },
      timeout: 10000,
    });
    const c = res.data || {};
    return {
      status: c.status,
      endedReason: c.endedReason,
      transcript: c.transcript,
      summary: c.summary,
      recordingUrl: c.recordingUrl,
      raw: c,
    };
  } catch (e: any) {
    console.log(`[engine] GET /call/status/${callId} -> ${e.response?.status ?? 'ERR'} ${e.message}`);
    return null;
  }
}
