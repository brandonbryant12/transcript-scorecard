import type { ScoringProvider } from './providers.js';
import type { BehaviorPolarity, Channel, RubricLevel } from './scorecard.js';

export type Speaker = 'employee' | 'customer';

export interface TranscriptTurn {
  readonly id: string;
  readonly speaker: Speaker;
  readonly text: string;
  readonly startSeconds: number;
}

// provisional: the call is still in progress. final: the whole call has been seen.
export type Stage = 'provisional' | 'final';

// ---------------------------------------------------------------------------
// Raw readings: exactly what the decision model returned, keyed for reuse.
// Turn-level readings are taken once per turn and never asked again.
// ---------------------------------------------------------------------------

export interface CustomerReading {
  // Probability-weighted sentiment level, 0 (very negative) to 4 (very positive).
  readonly sentiment: number;
  readonly sentimentConfidence: number;
  readonly emotion: string;
  readonly emotionConfidence: number;
}

export interface SkillReading {
  readonly expectedLevel: number;
  readonly confidence: number;
  readonly probabilities: ReadonlyArray<number>;
  // Probability that the call (so far) gives a fair basis to judge the skill. null if not asked.
  readonly observability: number | null;
}

export interface RiskReading {
  readonly expectedLevel: number;
  readonly confidence: number;
  readonly probabilities: ReadonlyArray<number>;
}

// A rubric reading without the fairness gate: what one audio clip or set of frames showed.
export interface LevelReading {
  readonly expectedLevel: number;
  readonly confidence: number;
  readonly probabilities: ReadonlyArray<number>;
}

// What one media channel of one employee turn showed, for every skill on that channel.
export interface ChannelReading {
  readonly skills: Readonly<Record<string, LevelReading>>;
  readonly tags: Readonly<Record<string, number>>;
}

// Readings taken from a turn's audio clip or video frames rather than its words.
export interface TurnMediaReading {
  readonly vocal?: ChannelReading;
  readonly visual?: ChannelReading;
  // Customer turns only: sentiment judged from the sound of the voice.
  readonly voice?: { readonly sentiment: number; readonly confidence: number };
}

export interface ScoringState {
  // tags[turnId][behaviorId] = P(the behaviour happens in that employee turn)
  readonly tags: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly customer: Readonly<Record<string, CustomerReading>>;
  readonly skills: Readonly<Record<string, SkillReading>>;
  // expected[behaviorId] = P(the situation that calls for the behaviour has occurred)
  readonly expected: Readonly<Record<string, number>>;
  readonly risk: RiskReading | null;
  // media[turnId]: readings from that turn's audio and video, when the call has them.
  readonly media: Readonly<Record<string, TurnMediaReading>>;
}

export const emptyScoringState: ScoringState = {
  tags: {},
  customer: {},
  skills: {},
  expected: {},
  risk: null,
  media: {},
};

// ---------------------------------------------------------------------------
// Composed results: what a coach reads.
// ---------------------------------------------------------------------------

// positive behaviours resolve to demonstrated / missed / not_applicable,
// negative behaviours to violated / clear. not_assessed: the behaviour needs audio or
// video and this call (or this provider) has none.
export type BehaviorStatus =
  'demonstrated' | 'missed' | 'not_applicable' | 'violated' | 'clear' | 'not_assessed';

export interface BehaviorResult {
  readonly behaviorId: string;
  readonly skillId: string;
  readonly name: string;
  readonly statement: string;
  readonly polarity: BehaviorPolarity;
  readonly critical: boolean;
  readonly tip: string;
  readonly status: BehaviorStatus;
  // Strongest single-turn detection, 0 when the behaviour was never tagged.
  readonly probability: number;
  // P(the behaviour was called for). null for negative and always-expected behaviours.
  readonly expected: number | null;
  // Employee turns where the behaviour was detected, in call order.
  readonly turnIds: ReadonlyArray<string>;
}

export interface SkillResult {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly channel: Channel;
  // false when the skill's channel was unavailable: the numbers below are then all zero
  // and the skill carries no weight in the overall score.
  readonly assessed: boolean;
  readonly weight: number;
  readonly levels: ReadonlyArray<RubricLevel>;
  // Probability-weighted rubric level; can fall between levels.
  readonly expectedLevel: number;
  // Most likely single level.
  readonly level: number;
  readonly normalizedScore: number;
  readonly confidence: number;
  readonly probabilities: ReadonlyArray<number>;
  // How fairly the skill can be judged from the call: "not yet" while it is live, "never
  // came up" once it is over. The skill counts towards the overall score in this proportion.
  readonly observability: number;
  readonly behaviors: ReadonlyArray<BehaviorResult>;
}

// A behaviour detected in one employee turn: the unit of evidence.
export interface Moment {
  readonly turnId: string;
  readonly behaviorId: string;
  readonly skillId: string;
  readonly name: string;
  readonly polarity: BehaviorPolarity;
  readonly critical: boolean;
  readonly probability: number;
}

export interface JourneyPoint {
  readonly turnId: string;
  readonly turnIndex: number;
  // The level used for the journey: the words alone, or the average of words and voice
  // when the turn's audio was also read.
  readonly sentiment: number;
  readonly textSentiment: number;
  readonly voiceSentiment: number | null;
  // True when the voice and the words are a full level or more apart: the customer said
  // one thing and sounded like another, which is worth a coach's attention.
  readonly mixedSignal: boolean;
  // sentiment rescaled to -1 (very negative) .. +1 (very positive)
  readonly valence: number;
  readonly confidence: number;
  readonly emotion: string;
  readonly emotionConfidence: number;
}

export interface JourneyShift {
  readonly turnId: string;
  readonly fromTurnId: string;
  readonly delta: number;
  readonly direction: 'up' | 'down';
  // What the employee said between the two customer turns.
  readonly employeeTurnIds: ReadonlyArray<string>;
}

export type JourneyArc =
  'recovered' | 'improved' | 'declined' | 'steady_positive' | 'steady_neutral' | 'steady_negative';

export interface CustomerJourney {
  readonly points: ReadonlyArray<JourneyPoint>;
  readonly arc: JourneyArc;
  readonly startValence: number;
  readonly endValence: number;
  readonly lowTurnId: string;
  readonly shifts: ReadonlyArray<JourneyShift>;
}

export interface RiskResult {
  readonly score: number;
  readonly level: number;
  readonly label: string;
  readonly confidence: number;
}

export interface CoachingPoint {
  readonly kind: 'strength' | 'opportunity' | 'flag';
  readonly skillId: string;
  readonly skillName: string;
  readonly behaviorId: string;
  readonly title: string;
  readonly detail: string;
  readonly turnIds: ReadonlyArray<string>;
  // Set when the customer's sentiment moved right after the turn.
  readonly impact: 'sentiment_up' | 'sentiment_down' | null;
}

export interface CoachingFocus {
  readonly skillId: string;
  readonly skillName: string;
  readonly levelLabel: string;
  readonly nextLevelLabel: string;
  readonly nextLevelDescription: string;
}

export interface CoachingSummary {
  readonly headline: string;
  readonly strengths: ReadonlyArray<CoachingPoint>;
  readonly opportunities: ReadonlyArray<CoachingPoint>;
  readonly flags: ReadonlyArray<CoachingPoint>;
  readonly focus: CoachingFocus | null;
  // Why a human should look at this evaluation. Empty when nothing stands out.
  readonly reviewReasons: ReadonlyArray<string>;
}

export interface EvaluationBody {
  readonly stage: Stage;
  readonly turnCount: number;
  // The channels that contributed readings: always verbal, plus vocal and visual when
  // the call had audio or video and the provider could read them.
  readonly channels: ReadonlyArray<Channel>;
  // null while too little of the scorecard is observable to score.
  readonly overallScore: number | null;
  // Share of the scorecard's weight the call gave a fair basis to judge.
  readonly coverage: number;
  readonly confidence: number;
  readonly skills: ReadonlyArray<SkillResult>;
  readonly moments: ReadonlyArray<Moment>;
  readonly journey: CustomerJourney | null;
  readonly risk: RiskResult | null;
  readonly coaching: CoachingSummary;
  readonly needsReview: boolean;
}

export interface UsageSummary {
  readonly requests: number;
  readonly questions: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  // Wall-clock time spent waiting on the provider for this evaluation.
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
}

export interface Evaluation extends EvaluationBody {
  readonly id: string;
  readonly callId: string;
  readonly runId: string;
  readonly provider: ScoringProvider;
  readonly model: string;
  readonly scorecardVersionId: string;
  readonly methodVersion: string;
  readonly usage: UsageSummary;
  readonly createdAt: string;
}
