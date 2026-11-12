import type { CoachReview, ScorecardDefinition } from '../../core/models';
import { buildReviewModel, ratedSkillCount, toReviewInput } from './review-form-model';

const definition = {
  name: 'Test',
  description: '',
  skills: [
    {
      id: 'empathy',
      name: 'Empathy',
      description: 'd',
      channel: 'verbal',
      weight: 50,
      enabled: true,
      levels: [
        { label: 'Low', description: 'd' },
        { label: 'High', description: 'd' },
      ],
      behaviors: [
        {
          id: 'restates',
          name: 'Restates',
          statement: 's',
          polarity: 'positive',
          critical: false,
          expectedWhen: null,
          tip: 't',
        },
      ],
    },
    {
      id: 'security',
      name: 'Security',
      description: 'd',
      channel: 'verbal',
      weight: 50,
      enabled: true,
      levels: [
        { label: 'Low', description: 'd' },
        { label: 'High', description: 'd' },
      ],
      behaviors: [],
    },
    {
      id: 'retired',
      name: 'Retired',
      description: 'd',
      channel: 'verbal',
      weight: 10,
      enabled: false,
      levels: [
        { label: 'Low', description: 'd' },
        { label: 'High', description: 'd' },
      ],
      behaviors: [],
    },
  ],
} satisfies ScorecardDefinition;

function review(overrides: Partial<CoachReview>): CoachReview {
  return {
    id: 'review-1',
    callId: 'call-1',
    scorecardVersionId: 'v1',
    coachName: 'Robin',
    status: 'submitted',
    notes: 'Good call',
    ratings: [{ skillId: 'empathy', level: 1, note: 'warm' }],
    behaviors: [{ behaviorId: 'restates', label: 'yes' }],
    createdAt: '',
    updatedAt: '',
    submittedAt: '',
    ...overrides,
  };
}

describe('buildReviewModel', () => {
  it('starts blank with one entry per enabled skill and behaviour', () => {
    const model = buildReviewModel(definition, null);
    expect(model.ratings).toEqual([
      { skillId: 'empathy', level: '', note: '' },
      { skillId: 'security', level: '', note: '' },
    ]);
    expect(model.behaviors).toEqual([{ behaviorId: 'restates', label: '' }]);
    expect(ratedSkillCount(model)).toBe(0);
  });

  it('loads a saved review, reading a null level as not applicable', () => {
    const model = buildReviewModel(
      definition,
      review({
        ratings: [
          { skillId: 'empathy', level: 1, note: 'warm' },
          { skillId: 'security', level: null, note: '' },
        ],
      }),
    );
    expect(model.notes).toBe('Good call');
    expect(model.ratings).toEqual([
      { skillId: 'empathy', level: '1', note: 'warm' },
      { skillId: 'security', level: 'na', note: '' },
    ]);
    expect(model.behaviors[0].label).toBe('yes');
    expect(ratedSkillCount(model)).toBe(1);
  });

  it('leaves a skill with no saved rating unanswered', () => {
    const model = buildReviewModel(definition, review({ status: 'draft' }));
    expect(model.ratings[1].level).toBe('');
  });
});

describe('toReviewInput', () => {
  it('sends rated skills, N/A as a null level, and labelled behaviours, leaving out blanks', () => {
    const model = buildReviewModel(definition, null);
    model.ratings[0] = { skillId: 'empathy', level: '0', note: '  curt  ' };
    model.ratings[1] = { skillId: 'security', level: 'na', note: '' };
    model.notes = 'Notes';

    expect(toReviewInput(model, 'call-1', '  Robin ', true)).toEqual({
      callId: 'call-1',
      coachName: 'Robin',
      notes: 'Notes',
      ratings: [
        { skillId: 'empathy', level: 0, note: 'curt' },
        { skillId: 'security', level: null, note: '' },
      ],
      behaviors: [],
      submit: true,
    });
  });

  it('leaves out a skill that has not been answered', () => {
    const model = buildReviewModel(definition, null);
    model.ratings[0] = { skillId: 'empathy', level: '1', note: '' };

    expect(toReviewInput(model, 'call-1', 'Robin', false).ratings).toEqual([
      { skillId: 'empathy', level: 1, note: '' },
    ]);
  });
});
