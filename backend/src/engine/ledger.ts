// In-memory call ledger so dashboard callsMade / talkMinutes are exact within a
// process lifetime without N+1 staging calls. Reset on restart (acceptable for a
// demo; swap for the optional SQLite store from plan section 15 for durability).

export interface LedgerEntry {
  callId: string;
  campaignId?: string | null;
  leadId: string;
  personaKey: string;
  startedAt: number;
  endedAt?: number;
  durationSec?: number;
  outcome?: string; // resulting paf_status
}

class Ledger {
  private entries = new Map<string, LedgerEntry>();

  record(entry: LedgerEntry): void {
    this.entries.set(entry.callId, entry);
  }

  complete(callId: string, patch: Partial<LedgerEntry>): void {
    const e = this.entries.get(callId);
    if (e) this.entries.set(callId, { ...e, ...patch });
  }

  get(callId: string): LedgerEntry | undefined {
    return this.entries.get(callId);
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }

  callsMade(): number {
    return this.entries.size;
  }

  talkSeconds(): number {
    return this.all().reduce((sum, e) => sum + (e.durationSec || 0), 0);
  }

  byCampaign(campaignId: string): LedgerEntry[] {
    return this.all().filter((e) => e.campaignId === campaignId);
  }
}

export const ledger = new Ledger();
