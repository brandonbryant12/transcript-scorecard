import { describe, expect, it } from 'vitest';
import {
  defaultScorecard,
  enabledSkills,
  ScorecardDefinitionSchema,
  scorecardProblems,
  type Behavior,
  type ScorecardDefinition,
  type Skill,
} from './scorecard.js';

const levels = [
  { label: 'Low', description: 'Low description' },
  { label: 'High', description: 'High description' },
];

const behavior = (id: string, overrides: Partial<Behavior> = {}): Behavior => ({
  id,
  name: `Behaviour ${id}`,
  statement: `Statement ${id}`,
  polarity: 'positive',
  critical: false,
  expectedWhen: null,
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

const definition = (skills: ReadonlyArray<Skill>): ScorecardDefinition => ({
  name: 'Test card',
  description: '',
  skills: [...skills],
});

const parses = (value: unknown): boolean => ScorecardDefinitionSchema.safeParse(value).success;

describe('defaultScorecard', () => {
  it('parses cleanly against the schema', () => {
    expect(ScorecardDefinitionSchema.parse(defaultScorecard)).toEqual(defaultScorecard);
  });

  it('has no cross-field problems', () => {
    expect(scorecardProblems(defaultScorecard)).toEqual([]);
  });
});

describe('ScorecardDefinitionSchema', () => {
  it('accepts a minimal valid definition', () => {
    expect(parses(definition([skill('a', { behaviors: [behavior('b')] })]))).toBe(true);
  });

  it('rejects unknown keys at every level', () => {
    expect(parses({ ...definition([skill('a')]), owner: 'x' })).toBe(false);
    expect(parses(definition([{ ...skill('a'), colour: 'red' } as Skill]))).toBe(false);
    expect(
      parses(definition([skill('a', { behaviors: [{ ...behavior('b'), extra: 1 } as Behavior] })])),
    ).toBe(false);
    expect(
      parses(
        definition([
          skill('a', { levels: [...levels, { label: 'x', description: 'y', z: 1 } as never] }),
        ]),
      ),
    ).toBe(false);
  });

  it.each(['Empathy', '1abc', 'a-b', 'a b', '', 'a'.repeat(41)])('rejects the id %j', (id) => {
    expect(parses(definition([skill(id)]))).toBe(false);
  });

  it.each(['a', 'a_1', 'a'.repeat(40)])('accepts the id %j', (id) => {
    expect(parses(definition([skill(id)]))).toBe(true);
  });

  it('rejects a skill with fewer than two rubric levels', () => {
    expect(parses(definition([skill('a', { levels: [levels[0]!] })]))).toBe(false);
  });

  it('rejects a skill with more than ten rubric levels', () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      label: `L${index}`,
      description: 'd',
    }));
    expect(parses(definition([skill('a', { levels: many })]))).toBe(false);
  });

  it('rejects a weight outside 0..100', () => {
    expect(parses(definition([skill('a', { weight: 101 })]))).toBe(false);
    expect(parses(definition([skill('a', { weight: -1 })]))).toBe(false);
  });

  it('rejects an empty skill list and a blank name', () => {
    expect(parses(definition([]))).toBe(false);
    expect(parses({ ...definition([skill('a')]), name: '   ' })).toBe(false);
  });

  it('rejects an unknown channel', () => {
    expect(parses(definition([{ ...skill('a'), channel: 'smell' } as unknown as Skill]))).toBe(
      false,
    );
  });
});

describe('scorecardProblems', () => {
  it('reports a repeated skill id', () => {
    expect(scorecardProblems(definition([skill('a'), skill('a')]))).toEqual([
      'Skill id "a" is used more than once',
    ]);
  });

  it('reports a behaviour id repeated across skills', () => {
    expect(
      scorecardProblems(
        definition([
          skill('a', { behaviors: [behavior('x')] }),
          skill('b', { behaviors: [behavior('x')] }),
        ]),
      ),
    ).toEqual(['Behaviour id "x" is used more than once']);
  });

  it('reports rubric labels that differ only by case or spacing', () => {
    expect(
      scorecardProblems(
        definition([
          skill('a', {
            levels: [
              { label: 'Good', description: 'd' },
              { label: ' good ', description: 'd' },
            ],
          }),
        ]),
      ),
    ).toEqual(['Skill a: rubric level labels must be distinct']);
  });

  it('reports a critical positive behaviour', () => {
    expect(
      scorecardProblems(
        definition([skill('a', { behaviors: [behavior('x', { critical: true })] })]),
      ),
    ).toEqual(['Behaviour x: only negative behaviours can be critical']);
  });

  it('reports a negative behaviour with an "expected when"', () => {
    expect(
      scorecardProblems(
        definition([
          skill('a', {
            behaviors: [behavior('x', { polarity: 'negative', expectedWhen: 'Always' })],
          }),
        ]),
      ),
    ).toEqual(['Behaviour x: negative behaviours have no "expected when"']);
  });

  it('reports a scorecard with no enabled, weighted skill', () => {
    expect(
      scorecardProblems(definition([skill('a', { enabled: false }), skill('b', { weight: 0 })])),
    ).toEqual(['At least one skill must be enabled with a weight above zero']);
  });
});

describe('enabledSkills', () => {
  it('keeps only enabled skills with a positive weight', () => {
    const card = definition([
      skill('a'),
      skill('b', { enabled: false }),
      skill('c', { weight: 0 }),
    ]);
    expect(enabledSkills(card).map((item) => item.id)).toEqual(['a']);
  });
});
