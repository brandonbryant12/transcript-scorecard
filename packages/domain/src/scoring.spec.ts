import { describe, expect, it } from 'vitest';
import type { ScoringState, TranscriptTurn } from './evaluation.js';
import { emptyScoringState } from './evaluation.js';
import type { Behavior, ScorecardDefinition, Skill } from './scorecard.js';
import {
  adjacentMass,
  composeEvaluation,
  composeJourney,
  mostLikelyLevel,
  normalizeLevel,
  weightedOverall,
} from './scoring.js';

const levels = ['L0', 'L1', 'L2', 'L3', 'L4'].map((label) => ({
  label,
  description: `${label} description`,
}));

const behavior = (id: string, overrides: Partial<Behavior> = {}): Behavior => ({
  id,
  name: `Behaviour ${id}`,
  statement: `Statement ${id}`,
  polarity: 'positive',
  critical: false,
  expectedWhen: `When ${id} is called for`,
  tip: `Tip ${id}`,
  ...overrides,
});

const skill = (id: string, overrides: Partial<Skill> = {}): Skill => ({
  id,
  name: `Skill ${id}`,
  description: `About ${id}`,
  channel: 'verbal',
  weight: 10,
  enabled: true,
  levels,
  behaviors: [],
  ...overrides,
});

const turn = (id: string, speaker: TranscriptTurn['speaker']): TranscriptTurn => ({
  id,
  speaker,
  text: `${speaker} says something`,
  startSeconds: 0,
});

describe('normalizeLevel', () => {
  it('maps the expected level onto 0-100 across the rubric', () => {
    expect(normalizeLevel(0, 5)).toBe(0);
    expect(normalizeLevel(3, 5)).toBe(75);
    expect(normalizeLevel(4, 5)).toBe(100);
  });

  it('keeps fractional levels and rounds to one decimal place', () => {
    expect(normalizeLevel(2.5, 5)).toBe(62.5);
    expect(normalizeLevel(1, 4)).toBe(33.3);
  });

  it('returns 0 for a rubric with fewer than two levels', () => {
    expect(normalizeLevel(1, 1)).toBe(0);
    expect(normalizeLevel(0, 0)).toBe(0);
  });
});

describe('mostLikelyLevel', () => {
  it('returns the index of the highest probability', () => {
    expect(mostLikelyLevel([0.1, 0.6, 0.3])).toBe(1);
  });

  it('prefers the lower level on a tie', () => {
    expect(mostLikelyLevel([0.4, 0.4, 0.2])).toBe(0);
  });

  it('returns 0 for an empty distribution', () => {
    expect(mostLikelyLevel([])).toBe(0);
  });
});

describe('adjacentMass', () => {
  it('sums the most likely level and both neighbours', () => {
    expect(adjacentMass([0.05, 0.1, 0.6, 0.2, 0.05])).toBeCloseTo(0.9);
  });

  it('counts only the one neighbour that exists at the edge of the rubric', () => {
    expect(adjacentMass([0.7, 0.2, 0.1])).toBeCloseTo(0.9);
  });

  it('is low when the distribution is split between distant levels', () => {
    expect(adjacentMass([0.45, 0, 0, 0.1, 0.45])).toBeCloseTo(0.45);
  });
});

describe('weightedOverall', () => {
  it('weights each skill by weight x observability', () => {
    const result = weightedOverall([
      { weight: 30, normalizedScore: 80, observability: 1, confidence: 0.9 },
      { weight: 10, normalizedScore: 40, observability: 0.5, confidence: 0.5 },
    ]);
    // effective weight 30 + 5 = 35; score (2400 + 200) / 35 = 74.29; confidence (27 + 2.5) / 35
    expect(result).toEqual({ overallScore: 74.3, coverage: 0.875, confidence: 0.843 });
  });

  it('ignores a skill the call has not reached yet', () => {
    const result = weightedOverall([
      { weight: 30, normalizedScore: 80, observability: 1, confidence: 1 },
      { weight: 70, normalizedScore: 0, observability: 0, confidence: 1 },
    ]);
    expect(result.overallScore).toBe(80);
    expect(result.coverage).toBe(0.3);
  });

  it('returns no score while coverage is below minCoverage', () => {
    expect(
      weightedOverall([{ weight: 100, normalizedScore: 90, observability: 0.05, confidence: 1 }]),
    ).toEqual({ overallScore: null, coverage: 0.05, confidence: 0 });
  });

  it('scores once coverage reaches minCoverage exactly', () => {
    const result = weightedOverall([
      { weight: 10, normalizedScore: 60, observability: 0.1, confidence: 0.7 },
    ]);
    expect(result).toEqual({ overallScore: 60, coverage: 0.1, confidence: 0.7 });
  });

  it('clamps observability outside 0..1', () => {
    const result = weightedOverall([
      { weight: 10, normalizedScore: 50, observability: 1.5, confidence: 0.5 },
      { weight: 10, normalizedScore: 100, observability: -1, confidence: 0.5 },
    ]);
    expect(result).toEqual({ overallScore: 50, coverage: 0.5, confidence: 0.5 });
  });

  it('returns no score when the scorecard carries no weight', () => {
    expect(weightedOverall([])).toEqual({ overallScore: null, coverage: 0, confidence: 0 });
  });

  it('leaves an unassessed skill out of the score and the coverage denominator', () => {
    const result = weightedOverall([
      { weight: 30, normalizedScore: 60, observability: 1, confidence: 0.8 },
      { weight: 70, normalizedScore: 0, observability: 0, confidence: 0, assessed: false },
    ]);
    expect(result).toEqual({ overallScore: 60, coverage: 1, confidence: 0.8 });
  });

  it('returns no score when every skill is unassessed', () => {
    expect(
      weightedOverall([
        { weight: 10, normalizedScore: 0, observability: 0, confidence: 0, assessed: false },
      ]),
    ).toEqual({ overallScore: null, coverage: 0, confidence: 0 });
  });
});

describe('composeEvaluation', () => {
  const definition: ScorecardDefinition = {
    name: 'Test',
    description: '',
    skills: [
      skill('listen', {
        weight: 20,
        behaviors: [
          behavior('ack'),
          behavior('restate'),
          behavior('own'),
          behavior('unread'),
          behavior('greet', { expectedWhen: null }),
          behavior('interrupt', { polarity: 'negative', expectedWhen: null }),
          behavior('leak', { polarity: 'negative', expectedWhen: null, critical: true }),
        ],
      }),
      skill('voice', {
        channel: 'vocal',
        weight: 10,
        behaviors: [
          behavior('calm', { expectedWhen: null }),
          behavior('snap', { polarity: 'negative', expectedWhen: null }),
        ],
      }),
      skill('camera', {
        channel: 'visual',
        weight: 10,
        behaviors: [behavior('faces', { expectedWhen: null })],
      }),
      skill('disabled', { enabled: false }),
    ],
  };
  const turns = [
    turn('t1', 'customer'),
    turn('t2', 'employee'),
    turn('t3', 'customer'),
    turn('t4', 'employee'),
  ];
  const state: ScoringState = {
    ...emptyScoringState,
    tags: {
      t2: { ack: 0.6, interrupt: 0.59, greet: 0.2 },
      t4: { ack: 0.9, interrupt: 0.7 },
    },
    expected: { restate: 0.5, own: 0.49 },
    skills: {
      listen: {
        expectedLevel: 2,
        confidence: 0.8,
        probabilities: [0, 0.1, 0.8, 0.1, 0],
        observability: 0.9,
      },
    },
    media: {
      t2: {
        vocal: {
          skills: {
            voice: { expectedLevel: 2, confidence: 0.6, probabilities: [0, 0.2, 0.6, 0.2, 0] },
          },
          tags: { calm: 0.7 },
        },
      },
      t4: {
        vocal: {
          skills: {
            voice: { expectedLevel: 4, confidence: 1, probabilities: [0, 0, 0, 0.2, 0.8] },
          },
          tags: { snap: 0.65 },
        },
      },
    },
  };
  const final = composeEvaluation(definition, state, turns, 'final');
  const skillOf = (id: string) => final.skills.find((item) => item.skillId === id)!;
  const behaviorOf = (id: string) =>
    final.skills.flatMap((item) => item.behaviors).find((item) => item.behaviorId === id)!;

  it('marks a positive behaviour demonstrated at exactly the detect threshold', () => {
    expect(behaviorOf('ack')).toMatchObject({
      status: 'demonstrated',
      probability: 0.9,
      turnIds: ['t2', 't4'],
    });
  });

  it('marks a conditional behaviour missed when it was expected at the threshold', () => {
    expect(behaviorOf('restate')).toMatchObject({ status: 'missed', expected: 0.5, turnIds: [] });
  });

  it('marks a conditional behaviour not applicable when it was probably not called for', () => {
    expect(behaviorOf('own')).toMatchObject({ status: 'not_applicable', expected: 0.49 });
  });

  it('marks a conditional behaviour with no expected reading not applicable', () => {
    expect(behaviorOf('unread')).toMatchObject({ status: 'not_applicable', expected: null });
  });

  it('calls an always-expected behaviour missed only at the final stage', () => {
    expect(behaviorOf('greet')).toMatchObject({ status: 'missed', expected: 1, probability: 0.2 });
    const provisional = composeEvaluation(definition, state, turns, 'provisional');
    const greet = provisional.skills[0]!.behaviors.find((item) => item.behaviorId === 'greet')!;
    expect(greet).toMatchObject({ status: 'not_applicable', expected: null });
  });

  it('marks a negative behaviour violated only in turns at or above the threshold', () => {
    expect(behaviorOf('interrupt')).toMatchObject({
      status: 'violated',
      turnIds: ['t4'],
      expected: null,
    });
  });

  it('marks a negative behaviour that never happened clear', () => {
    expect(behaviorOf('leak')).toMatchObject({ status: 'clear', probability: 0, turnIds: [] });
  });

  it('averages a vocal skill across the turn readings in state.media', () => {
    expect(skillOf('voice')).toMatchObject({
      assessed: true,
      expectedLevel: 3,
      probabilities: [0, 0.1, 0.3, 0.2, 0.4],
      level: 4,
      normalizedScore: 75,
      confidence: 0.8,
      observability: 1,
    });
  });

  it('reads vocal behaviours from the media tags of each turn', () => {
    expect(behaviorOf('calm')).toMatchObject({ status: 'demonstrated', turnIds: ['t2'] });
    expect(behaviorOf('snap')).toMatchObject({ status: 'violated', turnIds: ['t4'] });
  });

  it('leaves a visual skill with no frames unassessed with zeroed numbers', () => {
    expect(skillOf('camera')).toMatchObject({
      assessed: false,
      expectedLevel: 0,
      level: 0,
      normalizedScore: 0,
      confidence: 0,
      probabilities: [0, 0, 0, 0, 0],
      observability: 0,
    });
  });

  it('reports the behaviours of an unassessed skill as not_assessed, even at the final stage', () => {
    expect(behaviorOf('faces')).toMatchObject({ status: 'not_assessed', expected: null });
  });

  it('leaves the unassessed skill out of both the overall score and coverage', () => {
    // listen: weight 20 x observability 0.9 at 50; voice: weight 10 x 1 at 75; camera is
    // unassessed and drops out. (18 x 50 + 10 x 75) / 28 = 58.93; coverage 28 / 30.
    expect(final.overallScore).toBe(58.9);
    expect(final.coverage).toBe(0.933);
  });

  it('omits disabled skills', () => {
    expect(final.skills.map((item) => item.skillId)).toEqual(['listen', 'voice', 'camera']);
  });

  it('omits a verbal skill that has no reading yet', () => {
    const body = composeEvaluation(definition, { ...state, skills: {} }, turns, 'provisional');
    expect(body.skills.map((item) => item.skillId)).toEqual(['voice', 'camera']);
  });

  it('treats a verbal skill whose gate was not asked as fully observable', () => {
    const body = composeEvaluation(
      definition,
      { ...state, skills: { listen: { ...state.skills.listen!, observability: null } } },
      turns,
      'final',
    );
    expect(body.skills[0]!.observability).toBe(1);
  });

  it('orders moments by turn and keeps every detection', () => {
    expect(final.moments.map((moment) => `${moment.turnId}:${moment.behaviorId}`)).toEqual([
      't2:ack',
      't2:calm',
      't4:ack',
      't4:interrupt',
      't4:snap',
    ]);
    expect(final.moments[1]).toMatchObject({ skillId: 'voice', probability: 0.7 });
  });

  it('lists verbal plus each channel that produced an assessed skill', () => {
    expect(final.channels).toEqual(['verbal', 'vocal']);
  });

  it('lists vocal when only the customer voice was read', () => {
    const body = composeEvaluation(
      definition,
      {
        ...state,
        media: { t1: { voice: { sentiment: 3, confidence: 0.8 } } },
      },
      turns,
      'final',
    );
    expect(body.channels).toEqual(['verbal', 'vocal']);
  });

  it('lists only verbal for a transcript-only call', () => {
    const body = composeEvaluation(definition, { ...state, media: {} }, turns, 'final');
    expect(body.channels).toEqual(['verbal']);
  });

  it('records the stage and turn count and composes risk from its distribution', () => {
    const body = composeEvaluation(
      definition,
      {
        ...state,
        risk: { expectedLevel: 2, confidence: 0.7, probabilities: [0.1, 0.2, 0.6, 0.1] },
      },
      turns,
      'provisional',
    );
    expect(body.stage).toBe('provisional');
    expect(body.turnCount).toBe(4);
    expect(body.risk).toEqual({ score: 66.7, level: 2, label: 'Elevated', confidence: 0.7 });
    expect(final.risk).toBeNull();
  });
});

describe('composeJourney', () => {
  const reading = (sentiment: number) => ({
    sentiment,
    sentimentConfidence: 0.8,
    emotion: 'neutral',
    emotionConfidence: 0.7,
  });
  const journeyOf = (sentiments: ReadonlyArray<number>) => {
    const turns = sentiments.map((_, index) => turn(`c${index}`, 'customer'));
    const customer = Object.fromEntries(
      sentiments.map((sentiment, index) => [`c${index}`, reading(sentiment)]),
    );
    return composeJourney({ ...emptyScoringState, customer }, turns)!;
  };

  it('returns null when no customer turn has been read', () => {
    expect(composeJourney(emptyScoringState, [turn('e1', 'employee')])).toBeNull();
  });

  it('rescales sentiment 0..4 to valence -1..+1', () => {
    expect(journeyOf([0, 1, 2, 3, 4]).points.map((point) => point.valence)).toEqual([
      -1, -0.5, 0, 0.5, 1,
    ]);
  });

  it('records a shift and the employee turns between the two customer turns', () => {
    const turns = [
      turn('c1', 'customer'),
      turn('e1', 'employee'),
      turn('e2', 'employee'),
      turn('c2', 'customer'),
      turn('e3', 'employee'),
      turn('c3', 'customer'),
    ];
    const journey = composeJourney(
      { ...emptyScoringState, customer: { c1: reading(0), c2: reading(3), c3: reading(3.2) } },
      turns,
    )!;
    expect(journey.shifts).toEqual([
      {
        turnId: 'c2',
        fromTurnId: 'c1',
        delta: 1.5,
        direction: 'up',
        employeeTurnIds: ['e1', 'e2'],
      },
    ]);
    expect(journey.points.map((point) => point.turnIndex)).toEqual([0, 3, 5]);
    expect(journey).toMatchObject({
      arc: 'recovered',
      startValence: -1,
      endValence: 0.6,
      lowTurnId: 'c1',
    });
  });

  it('counts a change of exactly shiftThreshold as a shift', () => {
    expect(journeyOf([2, 2.8]).shifts).toHaveLength(1);
    expect(journeyOf([2, 2.78]).shifts).toHaveLength(0);
  });

  it('marks a downward shift', () => {
    expect(journeyOf([3, 1]).shifts[0]).toMatchObject({ direction: 'down', delta: -1 });
  });

  it('classifies a deep low that ends positive as recovered', () => {
    expect(journeyOf([1, 0, 3, 3]).arc).toBe('recovered');
  });

  it('classifies a rise without a deep low as improved', () => {
    expect(journeyOf([2, 2, 3.5, 3.5]).arc).toBe('improved');
  });

  it('classifies a fall as declined', () => {
    expect(journeyOf([3, 3, 1.5, 1.5]).arc).toBe('declined');
  });

  it('classifies flat journeys by their average valence', () => {
    expect(journeyOf([3, 3, 3]).arc).toBe('steady_positive');
    expect(journeyOf([2, 2.2, 2]).arc).toBe('steady_neutral');
    expect(journeyOf([1.4, 1.4, 1.4]).arc).toBe('steady_negative');
  });

  it('fuses voice sentiment 50/50 with the words and keeps both', () => {
    const journey = composeJourney(
      {
        ...emptyScoringState,
        customer: { c1: reading(1), c2: reading(1) },
        media: { c1: { voice: { sentiment: 3, confidence: 0.9 } } },
      },
      [turn('c1', 'customer'), turn('c2', 'customer')],
    )!;
    expect(journey.points[0]).toMatchObject({
      sentiment: 2,
      textSentiment: 1,
      voiceSentiment: 3,
      valence: 0,
    });
    expect(journey.points[1]).toMatchObject({ sentiment: 1, voiceSentiment: null, valence: -0.5 });
  });

  it('flags a mixed signal when voice and words differ by mixedSignalLevels or more', () => {
    const journey = composeJourney(
      {
        ...emptyScoringState,
        customer: { c1: reading(1), c2: reading(2), c3: reading(2) },
        media: {
          c1: { voice: { sentiment: 2, confidence: 0.9 } },
          c2: { voice: { sentiment: 2.9, confidence: 0.9 } },
        },
      },
      [turn('c1', 'customer'), turn('c2', 'customer'), turn('c3', 'customer')],
    )!;
    expect(journey.points.map((point) => point.mixedSignal)).toEqual([true, false, false]);
  });

  it('ignores readings keyed to employee turns', () => {
    const journey = composeJourney({ ...emptyScoringState, customer: { e1: reading(4) } }, [
      turn('e1', 'employee'),
    ]);
    expect(journey).toBeNull();
  });
});
