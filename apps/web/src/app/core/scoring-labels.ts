import type { BehaviorStatus, Channel, JourneyArc, LiveStatus, RunStatus } from './models';

export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = {
  verbal: 'Transcript',
  vocal: 'Audio',
  visual: 'Video',
};

/** What an unassessed skill is waiting for. */
export const CHANNEL_NEEDS: Readonly<Record<Channel, string>> = {
  verbal: 'Needs a transcript',
  vocal: 'Needs audio',
  visual: 'Needs video',
};

export const BEHAVIOR_STATUS_LABELS: Readonly<Record<BehaviorStatus, string>> = {
  demonstrated: 'Demonstrated',
  missed: 'Missed',
  not_applicable: 'Not called for',
  violated: 'Detected',
  clear: 'Clear',
  not_assessed: 'Not assessed',
};

export const ARC_LABELS: Readonly<Record<JourneyArc, string>> = {
  recovered: 'Recovered: went negative, ended positive',
  improved: 'Improved over the call',
  declined: 'Declined over the call',
  steady_positive: 'Steady and positive',
  steady_neutral: 'Steady and neutral',
  steady_negative: 'Steady and negative',
};

export const LIVE_STATUS_LABELS: Readonly<Record<LiveStatus, string>> = {
  ready: 'Ready',
  playing: 'Live',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const SENTIMENT_LABELS = ['Very negative', 'Negative', 'Neutral', 'Positive', 'Very positive'];

/** Names the nearest sentiment level for a 0 to 4 reading. */
export function sentimentLabel(sentiment: number): string {
  const index = Math.min(SENTIMENT_LABELS.length - 1, Math.max(0, Math.round(sentiment)));
  return SENTIMENT_LABELS[index];
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** Colour band for a 0 to 100 score. */
export function scoreTone(score: number | null): Tone {
  if (score === null) return 'neutral';
  if (score >= 80) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

/** Colour band for a -1 to +1 valence. */
export function valenceTone(valence: number): Tone {
  if (valence >= 0.25) return 'good';
  if (valence <= -0.25) return 'bad';
  return 'neutral';
}

export const REVEAL_INTERVAL_OPTIONS: readonly number[] = [250, 500, 1000, 2000, 5000];
export const DEFAULT_REVEAL_INTERVAL_MS = 1000;
export const SCORE_EVERY_TURNS_OPTIONS: readonly number[] = [1, 2, 3, 5, 8];
export const DEFAULT_SCORE_EVERY_TURNS = 2;
