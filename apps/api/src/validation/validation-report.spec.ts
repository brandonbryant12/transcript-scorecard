import type {
  BehaviorResult,
  BehaviorStatus,
  CoachBehaviorLabel,
  CoachReview,
  Evaluation,
  ScoringProvider,
  SkillResult,
} from '@scorecard/domain';
import { buildValidationReport, pairSkills } from './validation-report.js';

const levels = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    label: `L${index}`,
    description: `Level ${index}`,
  }));

const behavior = (behaviorId: string, status: BehaviorStatus): BehaviorResult => ({
  behaviorId,
  skillId: 'a',
  name: behaviorId,
  statement: behaviorId,
  polarity: status === 'violated' || status === 'clear' ? 'negative' : 'positive',
  critical: false,
  tip: '',
  status,
  probability: 0,
  expected: null,
  turnIds: [],
});

const skill = (skillId: string, overrides: Partial<SkillResult> = {}): SkillResult => ({
  skillId,
  name: `Skill ${skillId}`,
  description: '',
  channel: 'verbal',
  assessed: true,
  weight: 10,
  levels: levels(5),
  expectedLevel: 2,
  level: 2,
  normalizedScore: 50,
  confidence: 0.8,
  probabilities: [0, 0, 1, 0, 0],
  observability: 1,
  behaviors: [],
  ...overrides,
});

const evaluation = (
  callId: string,
  skills: ReadonlyArray<SkillResult>,
  overrides: Partial<Evaluation> = {},
): Evaluation => ({
  id: `evaluation-${callId}`,
  callId,
  runId: 'run-1',
  provider: 'gemini',
  model: 'gemini-decision-1',
  scorecardVersionId: 'support-quality-v1',
  methodVersion: 'moments-1',
  stage: 'final',
  turnCount: 4,
  channels: ['verbal'],
  overallScore: 50,
  coverage: 1,
  confidence: 0.8,
  skills,
  moments: [],
  journey: null,
  risk: null,
  coaching: {
    headline: '',
    strengths: [],
    opportunities: [],
    flags: [],
    focus: null,
    reviewReasons: [],
  },
  needsReview: false,
  usage: {
    requests: 1,
    questions: 1,
    inputTokens: 1,
    outputTokens: 0,
    latencyMs: 1,
    estimatedCostUsd: 0,
  },
  createdAt: '2026-11-11T00:00:00.000Z',
  ...overrides,
});

const review = (
  callId: string,
  coachName: string,
  ratings: ReadonlyArray<readonly [string, number | null]>,
  behaviors: ReadonlyArray<readonly [string, CoachBehaviorLabel]> = [],
): CoachReview => ({
  id: `review-${callId}-${coachName}`,
  callId,
  scorecardVersionId: 'support-quality-v1',
  coachName,
  status: 'submitted',
  notes: '',
  ratings: ratings.map(([skillId, level]) => ({ skillId, level, note: '' })),
  behaviors: behaviors.map(([behaviorId, label]) => ({ behaviorId, label })),
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  submittedAt: '2026-11-11T00:00:00.000Z',
});

const calls = [
  { id: 'call-1', subject: 'Billing' },
  { id: 'call-2', subject: 'Delivery' },
  { id: 'call-3', subject: 'Login' },
];

describe('pairSkills', () => {
  it('pairs a coach rating with the AI level, labels and expected level', () => {
    const pairs = pairSkills(
      review('call-1', 'Ana', [['a', 2]]),
      evaluation('call-1', [skill('a', { level: 3, expectedLevel: 3.2, confidence: 0.9 })]),
    );
    expect(pairs).toEqual([
      {
        skillId: 'a',
        skillName: 'Skill a',
        coach: 2,
        coachLabel: 'L2',
        ai: 3,
        aiLabel: 'L3',
        aiExpected: 3.2,
        levels: 5,
        confidence: 0.9,
      },
    ]);
  });

  it('leaves out a skill the coach marked not applicable', () => {
    const pairs = pairSkills(
      review('call-1', 'Ana', [
        ['a', 2],
        ['b', null],
      ]),
      evaluation('call-1', [skill('a'), skill('b')]),
    );
    expect(pairs.map((pair) => pair.skillId)).toEqual(['a']);
  });

  it('leaves out unassessed skills, unknown skills and ratings beyond the AI rubric', () => {
    const pairs = pairSkills(
      review('call-1', 'Ana', [
        ['a', 2],
        ['voice', 3],
        ['short', 4],
        ['gone', 1],
      ]),
      evaluation('call-1', [
        skill('a'),
        skill('voice', { assessed: false }),
        skill('short', { levels: levels(3) }),
      ]),
    );
    expect(pairs.map((pair) => pair.skillId)).toEqual(['a']);
  });
});

describe('buildValidationReport', () => {
  it('counts reviews, reviewed calls and coaches', () => {
    const report = buildValidationReport(
      [
        review('call-1', 'Ben', [['a', 2]]),
        review('call-1', 'Ana', [['a', 2]]),
        review('call-2', 'Ana', [['a', 2]]),
      ],
      [],
      calls,
    );
    expect(report).toMatchObject({
      submittedReviews: 3,
      reviewedCalls: 2,
      totalCalls: 3,
      coaches: ['Ana', 'Ben'],
      providers: [],
    });
  });

  it('reports each provider that scored a reviewed call, in provider order', () => {
    const evaluations = (['jev', 'gemini'] as ScoringProvider[]).map((provider) =>
      evaluation('call-1', [skill('a')], { provider, model: `${provider}-model` }),
    );
    const report = buildValidationReport([review('call-1', 'Ana', [['a', 2]])], evaluations, calls);
    expect(report.providers.map((item) => [item.provider, item.model, item.calls])).toEqual([
      ['gemini', 'gemini-model', 1],
      ['jev', 'jev-model', 1],
    ]);
  });

  it('computes skill agreement per provider and per skill', () => {
    const report = buildValidationReport(
      [
        review('call-1', 'Ana', [
          ['a', 3],
          ['b', 1],
        ]),
      ],
      [
        evaluation('call-1', [
          skill('a', { level: 3, expectedLevel: 3 }),
          skill('b', { level: 3, expectedLevel: 3 }),
        ]),
      ],
      calls,
    );
    const [gemini] = report.providers;
    expect(gemini!.all).toMatchObject({ n: 2, exact: 0.5, adjacent: 0.5, mae: 1, bias: 1 });
    expect(gemini!.skills.map((item) => [item.skillId, item.exact])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
  });

  it('lists disagreements largest miss first, then most confident first', () => {
    const report = buildValidationReport(
      [
        review('call-1', 'Ana', [
          ['a', 0],
          ['b', 2],
          ['c', 2],
        ]),
        review('call-9', 'Ana', [['a', 1]]),
      ],
      [
        evaluation('call-1', [
          skill('a', { level: 1, confidence: 0.5 }),
          skill('b', { level: 4, confidence: 0.6 }),
          skill('c', { level: 2 }),
        ]),
        evaluation('call-9', [skill('a', { level: 2, confidence: 0.9 })]),
      ],
      calls,
    );
    expect(
      report.providers[0]!.disagreements.map((item) => [item.callId, item.skillId, item.subject]),
    ).toEqual([
      ['call-1', 'b', 'Billing'],
      ['call-9', 'a', 'call-9'],
      ['call-1', 'a', 'Billing'],
    ]);
    expect(report.providers[0]!.disagreements[0]).toMatchObject({
      coachLevel: 2,
      coachLabel: 'L2',
      aiLevel: 4,
      aiLabel: 'L4',
    });
  });

  it('compares the overall score with the coach score on the same weights', () => {
    // Coach: (30 x 100 + 10 x 0) / 40 = 75 on call-1 and 25 on call-2; AI says 80 and 10.
    const report = buildValidationReport(
      [
        review('call-1', 'Ana', [
          ['a', 4],
          ['b', 0],
        ]),
        review('call-2', 'Ana', [
          ['a', 1],
          ['b', 1],
        ]),
      ],
      [
        evaluation('call-1', [skill('a', { weight: 30 }), skill('b', { weight: 10 })], {
          overallScore: 80,
        }),
        evaluation('call-2', [skill('a', { weight: 30 }), skill('b', { weight: 10 })], {
          overallScore: 10,
        }),
      ],
      calls,
    );
    // Errors +5 and -15.
    expect(report.providers[0]!.overall).toEqual({ n: 2, mae: 10, bias: -5 });
  });

  it('skips the overall comparison when the AI had no overall score', () => {
    const report = buildValidationReport(
      [review('call-1', 'Ana', [['a', 4]])],
      [evaluation('call-1', [skill('a')], { overallScore: null })],
      calls,
    );
    expect(report.providers[0]!.overall).toEqual({ n: 0, mae: 0, bias: 0 });
  });

  it('maps AI behaviour statuses to coach labels and skips unassessed ones', () => {
    const statuses: BehaviorStatus[] = [
      'demonstrated',
      'violated',
      'missed',
      'clear',
      'not_applicable',
      'not_assessed',
    ];
    const report = buildValidationReport(
      [
        review(
          'call-1',
          'Ana',
          [['a', 2]],
          statuses.map((status) => [status, 'yes'] as const),
        ),
      ],
      [
        evaluation('call-1', [
          skill('a', { behaviors: statuses.map((status) => behavior(status, status)) }),
        ]),
      ],
      calls,
    );
    // AI labels: yes, yes, no, no, na; not_assessed is not compared.
    expect(report.providers[0]!.behaviors).toEqual({
      n: 5,
      agreement: 0.4,
      precision: 1,
      recall: 0.4,
    });
  });

  it('agrees on behaviours where the AI status maps to the coach label', () => {
    const report = buildValidationReport(
      [
        review(
          'call-1',
          'Ana',
          [['a', 2]],
          [
            ['missed', 'no'],
            ['not_applicable', 'na'],
            ['unknown', 'yes'],
          ],
        ),
      ],
      [
        evaluation('call-1', [
          skill('a', {
            behaviors: [behavior('missed', 'missed'), behavior('not_applicable', 'not_applicable')],
          }),
        ]),
      ],
      calls,
    );
    expect(report.providers[0]!.behaviors).toMatchObject({ n: 2, agreement: 1 });
  });

  it('has no human baseline until two coaches rate the same call', () => {
    const report = buildValidationReport(
      [review('call-1', 'Ana', [['a', 2]]), review('call-2', 'Ben', [['a', 2]])],
      [evaluation('call-1', [skill('a')])],
      calls,
    );
    expect(report.humanBaseline).toBeNull();
  });

  it('measures coach-vs-coach agreement when two coaches rate one call', () => {
    const report = buildValidationReport(
      [
        review('call-1', 'Ana', [
          ['a', 3],
          ['b', 1],
          ['c', 2],
        ]),
        review('call-1', 'Ben', [
          ['a', 2],
          ['b', 1],
        ]),
      ],
      [evaluation('call-1', [skill('a'), skill('b'), skill('c')])],
      calls,
    );
    // Pairs (Ana, Ben): a (3, 2) and b (1, 1); c was rated by Ana only.
    expect(report.humanBaseline).toMatchObject({
      n: 2,
      exact: 0.5,
      adjacent: 1,
      mae: 0.5,
      bias: -0.5,
    });
  });

  it('omits a provider whose evaluations share no skill with the reviews', () => {
    const report = buildValidationReport(
      [review('call-1', 'Ana', [['voice', 2]])],
      [evaluation('call-1', [skill('voice', { assessed: false })])],
      calls,
    );
    expect(report.providers).toEqual([]);
  });
});
