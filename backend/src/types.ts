// Shared domain types for the PettyAF backend.

export type PersonaKey = 'child' | 'medieval' | 'angry';

export type PafStatus =
  | 'OPEN'
  | 'DEPLOYED'
  | 'VOICEMAIL'
  | 'GHOSTED'
  | 'PROMISED'
  | 'DISPUTED'
  | 'SETTLED'
  | 'WRITTEN_OFF';

export type CampaignMode = 'standard' | 'relentless';
export type CampaignRunState = 'draft' | 'active' | 'paused' | 'completed';
export type LivePhase = 'dialing' | 'talking' | 'analyzing' | 'done' | 'failed';

export interface CampaignSettings {
  mode: CampaignMode;
  unhingedLevel: number; // 1-10, default aggression for leads in this campaign
  defaultPersonaKey: PersonaKey;
  maxConcurrentCalls: number;
  endsAt: number; // epoch ms; 0 = no time window
}

export interface CampaignStats {
  leadCount: number;
  callsMade: number;
  promised: number;
  settled: number;
  collected: number;
  outstanding: number;
  liveNow: number;
}

export interface Campaign {
  id: string;
  name: string;
  purpose: string;
  runState: CampaignRunState;
  endsAt: number;
  settings: CampaignSettings;
  stats?: CampaignStats;
}

export interface QualAnswers {
  admittedDebt?: boolean;
  excuseGiven?: string;
  paymentCommitment?: string;
}

export interface CallResult {
  callId: string;
  endedReason?: string;
  durationSec?: number;
  transcript?: string;
  summary?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  outcome?: string;
  recordingUrl?: string;
  qualAnswers?: QualAnswers | null;
}

export interface Case {
  id: string;
  caseNumber: string;
  campaignId?: string | null;
  debtorName: string;
  debtorPhone: string;
  amount: number;
  currency: string;
  reason: string;
  sinceDate?: string;
  creditorName?: string;
  personaKey: PersonaKey;
  aggressionLevel: number;
  knownWeaknesses?: string;
  settlementOptions: string[];
  status: PafStatus;
  relentless: { enabled: boolean; callCount: number; active: boolean };
  lastCall: CallResult | null;
}

export interface LiveCall {
  callId: string;
  caseId: string;
  campaignId?: string | null;
  caseNumber: string;
  debtorName: string;
  personaKey: PersonaKey;
  amount: number;
  currency: string;
  phase: LivePhase;
  startedAt: string;
  durationSec: number;
  callCount: number;
  partialTranscript: string | null;
}
