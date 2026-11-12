import { describe, expect, it } from 'vitest';
import {
  agreementStats,
  behaviorAgreement,
  calibration,
  quadraticWeightedKappa,
  ReviewInputSchema,
  type LevelPair,
} from './validation.js';

const pair = (coach: number, ai: number, levels = 5) => ({ coach, ai, levels });

describe('quadraticWeightedKappa', () => {
  it('is 1 for perfect agreement', () => {
    expect(quadraticWeightedKappa([pair(0, 0, 3), pair(1, 1, 3), pair(2, 2, 3)])).toBe(1);
  });

  it('matches a small worked example', () => {
    // Three levels, four pairs (coach, ai): (0,0) (1,1) (2,1) (2,2).
    // Weights w(i,j) = (i-j)^2 / (3-1)^2: w(0,1) = w(1,2) = 0.25, w(0,2) = 1.
    // Observed disagreement: only (2,1), weight 0.25          -> 0.25
    // Marginals: coach [1, 1, 2], ai [1, 2, 1], n = 4. Expected count E(i,j) = coach_i x ai_j / 4.
    //   row 0: E(0,1) = 0.5 x 0.25 + E(0,2) = 0.25 x 1        -> 0.375
    //   row 1: E(1,0) = 0.25 x 0.25 + E(1,2) = 0.25 x 0.25    -> 0.125
    //   row 2: E(2,0) = 0.5 x 1 + E(2,1) = 1 x 0.25           -> 0.75
    // Expected disagreement 1.25; kappa = 1 - 0.25 / 1.25 = 0.8.
    expect(
      quadraticWeightedKappa([pair(0, 0, 3), pair(1, 1, 3), pair(2, 1, 3), pair(2, 2, 3)]),
    ).toBe(0.8);
  });

  it('is negative when the raters disagree systematically', () => {
    expect(quadraticWeightedKappa([pair(0, 2, 3), pair(2, 0, 3)])).toBeLessThan(0);
  });

  it('is undefined with fewer than two pairs', () => {
    expect(quadraticWeightedKappa([])).toBeNull();
    expect(quadraticWeightedKappa([pair(1, 1)])).toBeNull();
  });

  it('is undefined when the pairs mix rubric sizes', () => {
    expect(quadraticWeightedKappa([pair(1, 1, 5), pair(1, 2, 4)])).toBeNull();
  });

  it('is undefined when both raters put everything in one category', () => {
    expect(quadraticWeightedKappa([pair(2, 2), pair(2, 2), pair(2, 2)])).toBeNull();
  });

  it('is undefined when a level lies outside the rubric', () => {
    expect(quadraticWeightedKappa([pair(0, 5), pair(1, 1)])).toBeNull();
    expect(quadraticWeightedKappa([pair(-1, 0), pair(1, 1)])).toBeNull();
  });

  it('is undefined for a single-level rubric', () => {
    expect(quadraticWeightedKappa([pair(0, 0, 1), pair(0, 0, 1)])).toBeNull();
  });
});

describe('agreementStats', () => {
  const levelPair = (coach: number, ai: number, aiExpected: number): LevelPair => ({
    coach,
    ai,
    aiExpected,
    levels: 5,
    confidence: 0.8,
  });

  it('returns zeros and no kappa for no pairs', () => {
    expect(agreementStats([])).toEqual({ n: 0, exact: 0, adjacent: 0, mae: 0, bias: 0, qwk: null });
  });

  it('computes exact, adjacent, error and bias from the expected level', () => {
    const pairs = [levelPair(3, 3, 3.2), levelPair(1, 3, 2.6), levelPair(2, 1, 1)];
    expect(agreementStats(pairs)).toEqual({
      n: 3,
      exact: 0.333,
      adjacent: 0.667,
      // |0.2| + |1.6| + |-1| = 2.8 over 3
      mae: 0.933,
      // 0.2 + 1.6 - 1 = 0.8 over 3: the AI is slightly more lenient
      bias: 0.267,
      qwk: quadraticWeightedKappa(pairs),
    });
  });
});

describe('calibration', () => {
  const at = (confidence: number, exact: boolean): LevelPair => ({
    coach: 2,
    ai: exact ? 2 : 3,
    aiExpected: 2,
    levels: 5,
    confidence,
  });

  it('buckets pairs by confidence with inclusive lower bounds', () => {
    const buckets = calibration([
      at(0.3, true),
      at(0.5, false),
      at(0.69, true),
      at(0.9, true),
      at(1, false),
    ]);
    expect(buckets).toEqual([
      { label: 'Below 50%', n: 1, meanConfidence: 0.3, exact: 1 },
      { label: '50-69%', n: 2, meanConfidence: 0.595, exact: 0.5 },
      { label: '70-89%', n: 0, meanConfidence: 0, exact: 0 },
      { label: '90% and above', n: 2, meanConfidence: 0.95, exact: 0.5 },
    ]);
  });
});

describe('behaviorAgreement', () => {
  it('computes agreement, precision and recall on "yes"', () => {
    expect(
      behaviorAgreement([
        { coach: 'yes', ai: 'yes' },
        { coach: 'yes', ai: 'no' },
        { coach: 'no', ai: 'yes' },
        { coach: 'na', ai: 'na' },
        { coach: 'no', ai: 'no' },
      ]),
    ).toEqual({ n: 5, agreement: 0.6, precision: 0.5, recall: 0.5 });
  });

  it('leaves precision and recall undefined when nobody said yes', () => {
    expect(behaviorAgreement([{ coach: 'no', ai: 'na' }])).toEqual({
      n: 1,
      agreement: 0,
      precision: null,
      recall: null,
    });
  });

  it('returns an empty result for no pairs', () => {
    expect(behaviorAgreement([])).toEqual({ n: 0, agreement: 0, precision: null, recall: null });
  });
});

describe('ReviewInputSchema', () => {
  const valid = {
    callId: 'call-1',
    coachName: '  Ana  ',
    notes: '',
    ratings: [{ skillId: 'empathy', level: 3, note: '' }],
    behaviors: [{ behaviorId: 'restates_problem', label: 'yes' }],
    submit: true,
  };

  it('accepts a review and trims the coach name', () => {
    expect(ReviewInputSchema.parse(valid).coachName).toBe('Ana');
  });

  it('rejects unknown keys', () => {
    expect(ReviewInputSchema.safeParse({ ...valid, score: 5 }).success).toBe(false);
  });

  it('rejects levels that are not integers in 0..9', () => {
    const withLevel = (level: number) => ({
      ...valid,
      ratings: [{ skillId: 'a', level, note: '' }],
    });
    expect(ReviewInputSchema.safeParse(withLevel(10)).success).toBe(false);
    expect(ReviewInputSchema.safeParse(withLevel(-1)).success).toBe(false);
    expect(ReviewInputSchema.safeParse(withLevel(1.5)).success).toBe(false);
  });

  it('rejects a behaviour label outside yes/no/na', () => {
    expect(
      ReviewInputSchema.safeParse({ ...valid, behaviors: [{ behaviorId: 'a', label: 'maybe' }] })
        .success,
    ).toBe(false);
  });

  it('rejects a blank coach name', () => {
    expect(ReviewInputSchema.safeParse({ ...valid, coachName: '   ' }).success).toBe(false);
  });
});
