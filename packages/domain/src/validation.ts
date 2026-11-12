import { z } from 'zod';
import type { ScoringProvider } from './providers.js';

// ---------------------------------------------------------------------------
// Ground truth: a coach rates a call on the same scorecard, without seeing the AI.
// ---------------------------------------------------------------------------

// yes: the behaviour happened. no: it was called for and did not happen (positive) or it
// did not happen (negative). na: the call never called for it.
export const CoachBehaviorLabelSchema = z.enum(['yes', 'no', 'na']);
export type CoachBehaviorLabel = z.infer<typeof CoachBehaviorLabelSchema>;

export const ReviewInputSchema = z.strictObject({
  callId: z.string().min(1),
  coachName: z.string().trim().min(1).max(60),
  notes: z.string().max(4000),
  // `level: null` records that the coach judged the skill not applicable to this call.
  // A skill left out altogether has not been answered yet, which only a draft may do.
  ratings: z.array(
    z.strictObject({
      skillId: z.string().min(1),
      level: z.number().int().min(0).max(9).nullable(),
      note: z.string().max(1000),
    }),
  ),
  behaviors: z.array(
    z.strictObject({ behaviorId: z.string().min(1), label: CoachBehaviorLabelSchema }),
  ),
  // A draft is saved work in progress. Only submitted reviews count as ground truth.
  submit: z.boolean(),
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export interface CoachReview {
  readonly id: string;
  readonly callId: string;
  readonly scorecardVersionId: string;
  readonly coachName: string;
  readonly status: 'draft' | 'submitted';
  readonly notes: string;
  readonly ratings: ReadonlyArray<{
    readonly skillId: string;
    readonly level: number | null;
    readonly note: string;
  }>;
  readonly behaviors: ReadonlyArray<{
    readonly behaviorId: string;
    readonly label: CoachBehaviorLabel;
  }>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt: string | null;
}

export interface ReviewQueueItem {
  readonly callId: string;
  readonly subject: string;
  readonly customerName: string;
  readonly agentName: string;
  readonly turnCount: number;
  readonly submittedReviews: number;
  readonly coaches: ReadonlyArray<string>;
  // Why the AI wants a human here. Deliberately says nothing about the score itself.
  readonly aiNeedsReview: boolean;
  readonly aiConfidence: number | null;
}

// ---------------------------------------------------------------------------
// Agreement metrics.
// ---------------------------------------------------------------------------

export interface LevelPair {
  readonly coach: number;
  readonly ai: number;
  // The model's probability-weighted level, for error and bias.
  readonly aiExpected: number;
  readonly levels: number;
  readonly confidence: number;
}

export interface AgreementStats {
  readonly n: number;
  // Share of pairs on exactly the same rubric level.
  readonly exact: number;
  // Share within one level.
  readonly adjacent: number;
  // Mean absolute error in rubric levels.
  readonly mae: number;
  // Mean signed error in rubric levels. Positive: the AI is more lenient than the coach.
  readonly bias: number;
  // Quadratic weighted kappa: chance-corrected agreement that penalises big misses more.
  // null when it is undefined (too few pairs, mixed scale sizes, or no variation).
  readonly qwk: number | null;
}

const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const quadraticWeightedKappa = (
  pairs: ReadonlyArray<{ readonly coach: number; readonly ai: number; readonly levels: number }>,
): number | null => {
  if (pairs.length < 2) return null;
  const size = pairs[0]!.levels;
  if (size < 2 || pairs.some((pair) => pair.levels !== size)) return null;
  const observed = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const coachTotals = new Array<number>(size).fill(0);
  const aiTotals = new Array<number>(size).fill(0);
  for (const pair of pairs) {
    if (pair.coach < 0 || pair.coach >= size || pair.ai < 0 || pair.ai >= size) return null;
    observed[pair.coach]![pair.ai]! += 1;
    coachTotals[pair.coach]! += 1;
    aiTotals[pair.ai]! += 1;
  }
  let weightedObserved = 0;
  let weightedExpected = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const weight = ((i - j) * (i - j)) / ((size - 1) * (size - 1));
      weightedObserved += weight * observed[i]![j]!;
      weightedExpected += weight * ((coachTotals[i]! * aiTotals[j]!) / pairs.length);
    }
  }
  // Every rating in one category for both raters: agreement is perfect but kappa is undefined.
  if (weightedExpected === 0) return null;
  return round(1 - weightedObserved / weightedExpected);
};

export const agreementStats = (pairs: ReadonlyArray<LevelPair>): AgreementStats => {
  if (pairs.length === 0) return { n: 0, exact: 0, adjacent: 0, mae: 0, bias: 0, qwk: null };
  const n = pairs.length;
  return {
    n,
    exact: round(pairs.filter((pair) => pair.coach === pair.ai).length / n),
    adjacent: round(pairs.filter((pair) => Math.abs(pair.coach - pair.ai) <= 1).length / n),
    mae: round(pairs.reduce((sum, pair) => sum + Math.abs(pair.aiExpected - pair.coach), 0) / n),
    bias: round(pairs.reduce((sum, pair) => sum + (pair.aiExpected - pair.coach), 0) / n),
    qwk: quadraticWeightedKappa(pairs),
  };
};

export interface CalibrationBucket {
  readonly label: string;
  readonly n: number;
  readonly meanConfidence: number;
  // Share of pairs in the bucket where the AI's level matched the coach exactly.
  readonly exact: number;
}

const BUCKETS: ReadonlyArray<readonly [string, number, number]> = [
  ['Below 50%', 0, 0.5],
  ['50-69%', 0.5, 0.7],
  ['70-89%', 0.7, 0.9],
  ['90% and above', 0.9, 1.01],
];

// A calibrated model is right about as often as it says it is: in each confidence band,
// the exact-match rate should sit near the mean confidence.
export const calibration = (pairs: ReadonlyArray<LevelPair>): ReadonlyArray<CalibrationBucket> =>
  BUCKETS.map(([label, low, high]) => {
    const inBucket = pairs.filter((pair) => pair.confidence >= low && pair.confidence < high);
    return {
      label,
      n: inBucket.length,
      meanConfidence: inBucket.length
        ? round(inBucket.reduce((sum, pair) => sum + pair.confidence, 0) / inBucket.length)
        : 0,
      exact: inBucket.length
        ? round(inBucket.filter((pair) => pair.coach === pair.ai).length / inBucket.length)
        : 0,
    };
  });

export interface BehaviorAgreement {
  readonly n: number;
  // Share of behaviours where the AI's three-way status matches the coach's label.
  readonly agreement: number;
  // Of the behaviours the AI said happened, the share the coach also saw.
  readonly precision: number | null;
  // Of the behaviours the coach saw, the share the AI also detected.
  readonly recall: number | null;
}

export const behaviorAgreement = (
  pairs: ReadonlyArray<{ readonly coach: CoachBehaviorLabel; readonly ai: CoachBehaviorLabel }>,
): BehaviorAgreement => {
  const n = pairs.length;
  if (n === 0) return { n: 0, agreement: 0, precision: null, recall: null };
  const aiYes = pairs.filter((pair) => pair.ai === 'yes');
  const coachYes = pairs.filter((pair) => pair.coach === 'yes');
  const both = pairs.filter((pair) => pair.ai === 'yes' && pair.coach === 'yes').length;
  return {
    n,
    agreement: round(pairs.filter((pair) => pair.ai === pair.coach).length / n),
    precision: aiYes.length ? round(both / aiYes.length) : null,
    recall: coachYes.length ? round(both / coachYes.length) : null,
  };
};

export interface SkillAgreement extends AgreementStats {
  readonly skillId: string;
  readonly name: string;
}

export interface Disagreement {
  readonly callId: string;
  readonly subject: string;
  readonly coachName: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly coachLevel: number;
  readonly coachLabel: string;
  readonly aiLevel: number;
  readonly aiLabel: string;
  readonly aiExpected: number;
  readonly confidence: number;
}

export interface ProviderAgreement {
  readonly provider: ScoringProvider;
  readonly model: string;
  readonly calls: number;
  readonly all: AgreementStats;
  readonly skills: ReadonlyArray<SkillAgreement>;
  // Overall 0-100 score, coach vs AI, on calls where the coach rated every scored skill.
  readonly overall: { readonly n: number; readonly mae: number; readonly bias: number };
  readonly behaviors: BehaviorAgreement;
  readonly calibration: ReadonlyArray<CalibrationBucket>;
  readonly disagreements: ReadonlyArray<Disagreement>;
}

export interface ValidationReport {
  readonly submittedReviews: number;
  readonly reviewedCalls: number;
  readonly totalCalls: number;
  readonly coaches: ReadonlyArray<string>;
  // Coach-vs-coach agreement on calls rated by two or more coaches: the ceiling the AI
  // can reasonably be held to. null until two coaches have rated the same call.
  readonly humanBaseline: AgreementStats | null;
  readonly providers: ReadonlyArray<ProviderAgreement>;
}
