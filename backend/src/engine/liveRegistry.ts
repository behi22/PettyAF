import type { LiveCall } from '../types';

// The control room's single source of truth: the platform has no active-calls
// endpoint, so the backend tracks live calls itself. Pure in-memory.
class LiveRegistry {
  private byCall = new Map<string, LiveCall>();

  upsert(call: LiveCall): void {
    this.byCall.set(call.callId, call);
  }

  update(callId: string, patch: Partial<LiveCall>): void {
    const c = this.byCall.get(callId);
    if (c) this.byCall.set(callId, { ...c, ...patch });
  }

  remove(callId: string): void {
    this.byCall.delete(callId);
  }

  get(callId: string): LiveCall | null {
    return this.byCall.get(callId) ?? null;
  }

  all(): LiveCall[] {
    const now = Date.now();
    return [...this.byCall.values()].map((c) => ({
      ...c,
      durationSec: c.startedAt ? Math.max(0, Math.floor((now - Date.parse(c.startedAt)) / 1000)) : c.durationSec,
    }));
  }

  size(): number {
    return this.byCall.size;
  }
}

export const liveRegistry = new LiveRegistry();
