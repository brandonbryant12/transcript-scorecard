import { describe, expect, it } from 'vitest';
import { buildCoaching } from './coaching.js';
import type { BehaviorResult, CustomerJourney, SkillResult } from './evaluation.js';

const levels = ['L0', 'L1', 'L2', 'L3', 'L4'].map((label) => ({
  label,
  description: `${label} description`,
}));

const behavior = (behaviorId: string, overrides: Partial<BehaviorResult> = {}): BehaviorResult => ({
  behaviorId,
  skillId: 'skill',
  name: `Behaviour ${behaviorId}`,
  statement: `Statement ${behaviorId}`,
  polarity: 'positive',
  critical: false,
  tip: `Tip ${behaviorId}`,
  status: 'not_applicable',
  probability: 0,
  expected: null,
  turnIds: [],
  ...overrides,
});

const skill = (skillId: string, overrides: Partial<SkillResult> = {}): SkillResult => ({
  skillId,
  name: `Skill ${skillId}`,
  description: `About ${skillId}`,
  channel: 'verbal',
  assessed: true,
  weight: 10,
  levels,
  expectedLevel: 2,
  level: 2,
  normalizedScore: 50,
  confidence: 0.8,
  probabilities: [0, 0.1, 0.8, 0.1, 0],
  observability: 1,
  behaviors: [],
  ...overrides,
});

const journeyWithShift = (
  direction: 'up' | 'down',
  employeeTurnIds: ReadonlyArray<string>,
): CustomerJourney => ({
  points: [],
  arc: 'steady_neutral',
  startValence: 0,
  endValence: 0,
  lowTurnId: 'c1',
  shifts: [
    {
      turnId: 'c2',
      fromTurnId: 'c1',
      delta: direction === 'up' ? 1 : -1,
      direction,
      employeeTurnIds,
    },
  ],
});

const titles = (points: ReadonlyArray<{ readonly title: string }>) => points.map((p) => p.title);

describe('buildCoaching', () => {
  it('ranks strengths by skill weight x detection probability and keeps the top three', () => {
    const coaching = buildCoaching(
      [
        skill('a', {
          weight: 20,
          behaviors: [
            behavior('b1', { status: 'demonstrated', probability: 0.9 }),
            behavior('b2', { status: 'demonstrated', probability: 0.7 }),
          ],
        }),
        skill('b', {
          weight: 10,
          behaviors: [
            behavior('b3', { status: 'demonstrated', probability: 0.95 }),
            behavior('b4', { status: 'demonstrated', probability: 0.65 }),
          ],
        }),
      ],
      null,
      'final',
    );
    expect(titles(coaching.strengths)).toEqual(['Behaviour b1', 'Behaviour b2', 'Behaviour b3']);
    expect(coaching.strengths[0]).toMatchObject({
      kind: 'strength',
      skillId: 'a',
      skillName: 'Skill a',
      detail: 'Statement b1',
      impact: null,
    });
  });

  it('ranks a non-critical violation above any missed behaviour, and misses by weight x expected', () => {
    const coaching = buildCoaching(
      [
        skill('a', {
          weight: 10,
          behaviors: [behavior('m1', { status: 'missed', expected: 0.9 })],
        }),
        skill('b', {
          weight: 30,
          behaviors: [behavior('m2', { status: 'missed', expected: 0.5 })],
        }),
        skill('c', {
          weight: 5,
          behaviors: [
            behavior('v1', { status: 'violated', polarity: 'negative', turnIds: ['e1'] }),
          ],
        }),
        skill('d', {
          weight: 1,
          behaviors: [behavior('m3', { status: 'missed', expected: 0.6 })],
        }),
      ],
      null,
      'final',
    );
    expect(titles(coaching.opportunities)).toEqual([
      'Behaviour v1',
      'Behaviour m2',
      'Behaviour m1',
    ]);
    expect(coaching.opportunities[0]).toMatchObject({ kind: 'opportunity', detail: 'Tip v1' });
  });

  it('raises a critical violation as a flag, not an opportunity, and puts it in the headline', () => {
    const coaching = buildCoaching(
      [
        skill('a', {
          behaviors: [
            behavior('breach', {
              status: 'violated',
              polarity: 'negative',
              critical: true,
              turnIds: ['e2'],
            }),
          ],
        }),
      ],
      null,
      'final',
    );
    expect(coaching.flags).toHaveLength(1);
    expect(coaching.flags[0]).toMatchObject({
      kind: 'flag',
      detail: 'Tip breach',
      turnIds: ['e2'],
    });
    expect(coaching.opportunities).toEqual([]);
    expect(coaching.headline).toBe('Critical: Behaviour breach');
    expect(coaching.reviewReasons[0]).toBe('Critical behaviour detected: Behaviour breach');
  });

  it('sets sentiment_up on a strength whose turn precedes an upward shift, and ranks it first', () => {
    const coaching = buildCoaching(
      [
        skill('heavy', {
          weight: 50,
          behaviors: [behavior('big', { status: 'demonstrated', probability: 1, turnIds: ['e5'] })],
        }),
        skill('light', {
          weight: 1,
          behaviors: [
            behavior('moved', { status: 'demonstrated', probability: 0.6, turnIds: ['e1'] }),
          ],
        }),
      ],
      journeyWithShift('up', ['e1']),
      'final',
    );
    expect(coaching.strengths.map((point) => [point.title, point.impact])).toEqual([
      ['Behaviour moved', 'sentiment_up'],
      ['Behaviour big', null],
    ]);
  });

  it('sets sentiment_down on a violation followed by a downward shift', () => {
    const coaching = buildCoaching(
      [
        skill('a', {
          behaviors: [
            behavior('rude', { status: 'violated', polarity: 'negative', turnIds: ['e1'] }),
          ],
        }),
      ],
      journeyWithShift('down', ['e1']),
      'final',
    );
    expect(coaching.opportunities[0]!.impact).toBe('sentiment_down');
  });

  it('does not credit a positive behaviour with a downward shift', () => {
    const coaching = buildCoaching(
      [
        skill('a', {
          behaviors: [behavior('b', { status: 'demonstrated', probability: 1, turnIds: ['e1'] })],
        }),
      ],
      journeyWithShift('down', ['e1']),
      'final',
    );
    expect(coaching.strengths[0]!.impact).toBeNull();
  });

  it('ignores the behaviours of an unassessed skill', () => {
    const coaching = buildCoaching(
      [
        skill('voice', {
          assessed: false,
          observability: 0,
          behaviors: [behavior('b', { status: 'demonstrated', probability: 1 })],
        }),
      ],
      null,
      'final',
    );
    expect(coaching.strengths).toEqual([]);
  });

  describe('focus', () => {
    it('picks the skill losing the most weighted points, with the next level description', () => {
      const coaching = buildCoaching(
        [
          // loses 30 x 25 = 750
          skill('big', { weight: 30, level: 3, normalizedScore: 75 }),
          // loses 10 x 100 = 1000
          skill('low', { weight: 10, level: 0, normalizedScore: 0 }),
        ],
        null,
        'final',
      );
      expect(coaching.focus).toEqual({
        skillId: 'low',
        skillName: 'Skill low',
        levelLabel: 'L0',
        nextLevelLabel: 'L1',
        nextLevelDescription: 'L1 description',
      });
    });

    it('skips skills already at the top level or not yet observable', () => {
      const coaching = buildCoaching(
        [
          skill('top', { level: 4, normalizedScore: 100 }),
          skill('hidden', { level: 0, normalizedScore: 0, observability: 0.4 }),
        ],
        null,
        'final',
      );
      expect(coaching.focus).toBeNull();
    });
  });

  describe('review reasons', () => {
    it('routes a skill to review when adjacent mass is below reviewAdjacentMass', () => {
      const coaching = buildCoaching(
        [skill('split', { level: 4, probabilities: [0.4, 0, 0, 0, 0.6] })],
        null,
        'final',
      );
      expect(coaching.reviewReasons).toEqual([
        'Uncertain on Skill split: the model is split between distant rubric levels',
      ]);
    });

    it('does not route an unobservable skill for uncertainty', () => {
      const coaching = buildCoaching(
        [skill('split', { level: 4, probabilities: [0.4, 0, 0, 0, 0.6], observability: 0.3 })],
        null,
        'final',
      );
      expect(coaching.reviewReasons).toEqual([]);
    });

    it('routes a top-level rating with a repeated violation', () => {
      const coaching = buildCoaching(
        [
          skill('a', {
            level: 4,
            normalizedScore: 100,
            probabilities: [0, 0, 0, 0.1, 0.9],
            behaviors: [
              behavior('slip', { status: 'violated', polarity: 'negative', turnIds: ['e1', 'e3'] }),
            ],
          }),
        ],
        null,
        'final',
      );
      expect(coaching.reviewReasons).toEqual([
        'Skill a is rated at the top level despite a repeated problem behaviour',
      ]);
    });

    it('does not route a top-level rating with a single repaired slip', () => {
      const coaching = buildCoaching(
        [
          skill('a', {
            level: 4,
            normalizedScore: 100,
            probabilities: [0, 0, 0, 0.1, 0.9],
            behaviors: [
              behavior('slip', { status: 'violated', polarity: 'negative', turnIds: ['e1'] }),
            ],
          }),
        ],
        null,
        'final',
      );
      expect(coaching.reviewReasons).toEqual([]);
    });

    it('routes a low rating when every positive behaviour was demonstrated, only at the final stage', () => {
      const skills = [
        skill('a', {
          level: 1,
          normalizedScore: 25,
          probabilities: [0.1, 0.8, 0.1, 0, 0],
          behaviors: [behavior('b', { status: 'demonstrated', probability: 0.9 })],
        }),
      ];
      expect(buildCoaching(skills, null, 'final').reviewReasons).toEqual([
        'Skill a is rated low although every expected behaviour was detected',
      ]);
      expect(buildCoaching(skills, null, 'provisional').reviewReasons).toEqual([]);
    });
  });

  describe('headline', () => {
    it('waits for the first observable skill', () => {
      expect(
        buildCoaching([skill('a', { observability: 0.2 })], null, 'provisional').headline,
      ).toBe('Listening for the first scoreable moments');
    });

    it('names only the strongest skill when it is also the focus', () => {
      expect(buildCoaching([skill('a')], null, 'final').headline).toBe('Strongest on Skill a');
    });

    it('names the strongest skill and the biggest lever', () => {
      const coaching = buildCoaching(
        [
          skill('good', { level: 3, normalizedScore: 75 }),
          skill('weak', { level: 1, normalizedScore: 25 }),
        ],
        null,
        'final',
      );
      expect(coaching.headline).toBe('Strongest on Skill good; biggest lever is Skill weak');
    });
  });
});
