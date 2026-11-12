// Fixed vocabularies for the customer-side signals. They are not part of the scorecard:
// they describe the customer, they do not grade the employee.

export const SENTIMENT_LEVELS = [
  'Very negative: angry, hostile, or threatening to leave or escalate',
  'Negative: frustrated, worried, doubtful or dissatisfied',
  'Neutral: matter-of-fact, giving or asking for information with no clear feeling',
  'Positive: satisfied, relieved or appreciative',
  'Very positive: delighted or openly grateful',
] as const;

export const SENTIMENT_LABELS = [
  'Very negative',
  'Negative',
  'Neutral',
  'Positive',
  'Very positive',
] as const;

// Keys are sorted alphabetically by the Gemini Decisions API before evaluation, so no
// key relies on its position. "neutral" is the explicit catch-all.
export const EMOTIONS = {
  anxious: 'Worried about consequences, under time pressure, or uneasy about a risk.',
  cooperative: 'Engaged and working the problem with the employee, without notable distress.',
  frustrated:
    'Annoyed or exasperated with the employee, the company, or having to repeat themselves.',
  neutral: 'Matter-of-fact; no clear emotional colour.',
  reassured: 'Relieved, calmer, appreciative, or confident the issue is in good hands.',
  skeptical: 'Doubting what they have been told, or pressing for proof or a commitment.',
} as const;

export type EmotionLabel = keyof typeof EMOTIONS;
export const EMOTION_LABELS = Object.keys(EMOTIONS) as ReadonlyArray<EmotionLabel>;

export const RISK_LEVELS = [
  'Low: the customer is satisfied or calmly working with the employee',
  'Guarded: some frustration or doubt, but still engaged',
  'Elevated: clear dissatisfaction, repeated pushback, or loss of trust',
  'High: asks for a supervisor, threatens to complain or cancel, or has given up on the employee',
] as const;

export const RISK_LABELS = ['Low', 'Guarded', 'Elevated', 'High'] as const;

// 0..4 sentiment level to a -1..+1 valence.
export const sentimentToValence = (sentiment: number): number =>
  Math.max(-1, Math.min(1, (sentiment - 2) / 2));
