import type { ScorecardDefinition } from '../../core/models';
import {
  newBehavior,
  slugify,
  toDefinition,
  toFormModel,
  uniqueId,
  weightShares,
} from './scorecard-form-model';

const definition: ScorecardDefinition = {
  name: 'Support quality',
  description: 'How well calls go.',
  skills: [
    {
      id: 'empathy',
      name: 'Empathy',
      description: 'Listens.',
      channel: 'verbal',
      weight: 30,
      enabled: true,
      levels: [
        { label: 'Low', description: 'Ignores the customer.' },
        { label: 'High', description: 'Reflects the customer.' },
      ],
      behaviors: [
        {
          id: 'restates_problem',
          name: 'Restates the problem',
          statement: 'The employee restates the problem.',
          polarity: 'positive',
          critical: false,
          expectedWhen: 'The customer has described a problem.',
          tip: 'Play it back.',
        },
        {
          id: 'dismisses',
          name: 'Dismisses',
          statement: 'The employee dismisses the customer.',
          polarity: 'negative',
          critical: true,
          expectedWhen: null,
          tip: 'Do not.',
        },
      ],
    },
    {
      id: 'tone',
      name: 'Tone',
      description: 'Sounds calm.',
      channel: 'vocal',
      weight: 10,
      enabled: false,
      levels: [
        { label: 'Tense', description: 'Rushed.' },
        { label: 'Warm', description: 'Calm.' },
      ],
      behaviors: [],
    },
  ],
};

describe('scorecard form model', () => {
  it('round-trips an unedited definition exactly, so "no changes" is detectable', () => {
    expect(toDefinition(toFormModel(definition))).toEqual(definition);
  });

  it('copies the definition instead of sharing its objects', () => {
    const model = toFormModel(definition);
    model.skills[0].levels[0].label = 'Changed';
    expect(definition.skills[0].levels[0].label).toBe('Low');
  });

  it('clears the fields that do not apply to a behaviour polarity', () => {
    const model = toFormModel(definition);
    // A positive behaviour cannot be critical; a negative one has no "expected when".
    model.skills[0].behaviors[0].critical = true;
    model.skills[0].behaviors[1].expectedWhen = 'Whenever';
    const result = toDefinition(model);
    expect(result.skills[0].behaviors[0].critical).toBe(false);
    expect(result.skills[0].behaviors[1].expectedWhen).toBeNull();
  });

  it('turns a blank "expected when" into null and trims text', () => {
    const model = toFormModel(definition);
    model.skills[0].behaviors[0].expectedWhen = '   ';
    model.skills[0].name = '  Empathy  ';
    const result = toDefinition(model);
    expect(result.skills[0].behaviors[0].expectedWhen).toBeNull();
    expect(result.skills[0].name).toBe('Empathy');
  });

  it('gives new behaviours unique ids made from their names', () => {
    const model = toFormModel(definition);
    model.skills[0].behaviors.push({
      ...newBehavior(),
      name: 'Dismisses',
      statement: 's',
      tip: 't',
    });
    model.skills[1].behaviors.push({
      ...newBehavior(),
      name: 'Sounds calm & kind!',
      statement: 's',
      tip: 't',
    });
    const result = toDefinition(model);
    expect(result.skills[0].behaviors.map((behavior) => behavior.id)).toEqual([
      'restates_problem',
      'dismisses',
      'dismisses_2',
    ]);
    expect(result.skills[1].behaviors[0].id).toBe('sounds_calm_kind');
  });

  it('treats an emptied weight field as zero', () => {
    const model = toFormModel(definition);
    model.skills[0].weight = Number.NaN;
    expect(toDefinition(model).skills[0].weight).toBe(0);
  });
});

describe('slugify and uniqueId', () => {
  it('produces ids the API accepts', () => {
    expect(slugify('Owns a mistake')).toBe('owns_a_mistake');
    expect(slugify('  3rd-party Hand-off  ')).toBe('rd_party_hand_off');
    expect(slugify('Écoute active')).toBe('ecoute_active');
    expect(slugify('!!!')).toBe('');
    expect(slugify('x'.repeat(60))).toHaveLength(40);
    expect(slugify('A very long behaviour name that keeps going and going')).toMatch(
      /^[a-z][a-z0-9_]{0,39}$/,
    );
  });

  it('falls back to a generic id and numbers duplicates', () => {
    expect(uniqueId('', new Set())).toBe('item');
    expect(uniqueId('tone', new Set(['tone', 'tone_2']))).toBe('tone_3');
    expect(uniqueId('x'.repeat(40), new Set(['x'.repeat(40)]))).toHaveLength(40);
  });
});

describe('weightShares', () => {
  it('shares the enabled weight and gives disabled skills nothing', () => {
    const shares = weightShares(toFormModel(definition));
    expect(shares.get('empathy')).toBe(1);
    expect(shares.get('tone')).toBe(0);
  });

  it('does not require weights to add up to 100', () => {
    const model = toFormModel(definition);
    model.skills[1].enabled = true;
    const shares = weightShares(model);
    expect(shares.get('empathy')).toBeCloseTo(0.75);
    expect(shares.get('tone')).toBeCloseTo(0.25);
  });

  it('is all zeros when nothing is enabled', () => {
    const model = toFormModel(definition);
    model.skills[0].enabled = false;
    expect([...weightShares(model).values()]).toEqual([0, 0]);
  });
});
