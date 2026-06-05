import type { PafStatus, QualAnswers } from '../types';

// Single source of truth for status classification (plan section 13).
// endedReason comes from the ENGINE status poll (not a staging call_logs column).

export function classifyStatus(
  endedReason: string | undefined,
  qual: QualAnswers | null | undefined,
): PafStatus {
  const r = (endedReason || '').toLowerCase();

  if (r === 'voicemail' || r === 'silence-timed-out') return 'VOICEMAIL';
  if (r === 'customer-did-not-answer' || r === 'customer-busy' || r === 'call-canceled') return 'GHOSTED';
  if (r === 'technical-error') return 'OPEN'; // revert, retryable

  // customer-ended-call / assistant-ended-call / ended -> read qualification answers
  if (qual?.admittedDebt === true && qual?.paymentCommitment) return 'PROMISED';
  if (qual?.admittedDebt === false) return 'DISPUTED';

  // Ended but ambiguous (admitted with no commitment, or no qual data yet): treat as DISPUTED.
  return 'DISPUTED';
}

export const UI_STAMP: Record<PafStatus, string> = {
  OPEN: 'OPEN',
  DEPLOYED: 'COLLECTOR DEPLOYED',
  VOICEMAIL: 'SENT TO VOICEMAIL',
  GHOSTED: 'GHOSTED US',
  PROMISED: 'PROMISED FRIDAY',
  DISPUTED: 'DISPUTED',
  SETTLED: 'SETTLED',
  WRITTEN_OFF: 'WRITTEN OFF',
};

// Statuses a lead can be in to be (re)dialed by the engine.
export const DIALABLE_STATUSES: PafStatus[] = ['OPEN', 'GHOSTED', 'VOICEMAIL', 'DISPUTED'];
// Terminal-for-dialing.
export const TERMINAL_STATUSES: PafStatus[] = ['PROMISED', 'SETTLED', 'WRITTEN_OFF'];
