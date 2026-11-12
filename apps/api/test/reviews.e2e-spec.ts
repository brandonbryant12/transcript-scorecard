import type {
  CallSummary,
  CoachReview,
  ReviewQueueItem,
  RunDetail,
  RunSummary,
  ValidationReport,
} from '@scorecard/domain';
import request from 'supertest';
import { createTestApp, waitFor, type TestApp } from './test-app.js';

let ctx: TestApp;
let runId: string;

const review = (overrides: object = {}) => ({
  callId: 'call-1003',
  coachName: 'Ana',
  notes: '',
  ratings: [{ skillId: 'empathy', level: 3, note: '' }],
  behaviors: [],
  submit: false,
  ...overrides,
});

const put = (body: object, status: number) =>
  request(ctx.http).put('/api/reviews').send(body).expect(status);

const report = async (): Promise<ValidationReport> =>
  (await request(ctx.http).get('/api/validation').expect(200)).body as ValidationReport;

beforeAll(async () => {
  ctx = await createTestApp();
  // Ground truth is compared with AI results, so score two calls first. The fake provider
  // puts every five-level rubric on level 3 and answers every yes/no question 0.8.
  const started = await request(ctx.http)
    .post('/api/runs')
    .send({ provider: 'gemini', callIds: ['call-1003', 'call-1001'] })
    .expect(202);
  runId = started.body.id;
  await waitFor(
    async () => (await request(ctx.http).get(`/api/runs/${runId}`)).body as RunDetail,
    (run) => run.status === 'completed',
  );
});

afterAll(async () => {
  await ctx.app.close();
});

describe('saving a review', () => {
  let draft: CoachReview;

  it('saves a draft that does not count as ground truth', async () => {
    draft = (await put(review({ notes: 'first pass' }), 200)).body as CoachReview;
    expect(draft).toMatchObject({
      callId: 'call-1003',
      coachName: 'Ana',
      status: 'draft',
      notes: 'first pass',
      scorecardVersionId: 'support-quality-v1',
      submittedAt: null,
      ratings: [{ skillId: 'empathy', level: 3, note: '' }],
    });
    expect((await report()).submittedReviews).toBe(0);
  });

  it('submits by saving again as the same coach, keeping one review', async () => {
    const submitted = (
      await put(
        review({
          ratings: [
            { skillId: 'empathy', level: 3, note: '' },
            { skillId: 'accuracy', level: 1, note: 'Promised a date it could not keep' },
          ],
          behaviors: [
            { behaviorId: 'verifies_identity', label: 'yes' },
            { behaviorId: 'unverified_change', label: 'no' },
          ],
          submit: true,
        }),
        200,
      )
    ).body as CoachReview;
    expect(submitted).toMatchObject({
      id: draft.id,
      status: 'submitted',
      createdAt: draft.createdAt,
      submittedAt: expect.any(String),
    });
    expect(submitted.ratings).toHaveLength(2);
    expect(submitted.behaviors).toHaveLength(2);

    const listed = (await request(ctx.http).get('/api/reviews?callId=call-1003').expect(200))
      .body as CoachReview[];
    expect(listed.map((item) => [item.id, item.status])).toEqual([[draft.id, 'submitted']]);
  });

  it('shows the submitted review on the call', async () => {
    const calls = (await request(ctx.http).get('/api/calls').expect(200)).body as CallSummary[];
    expect(calls.find((call) => call.id === 'call-1003')!.submittedReviews).toBe(1);
  });
});

describe('review validation', () => {
  it('rejects an unknown skill', async () => {
    const response = await put(review({ ratings: [{ skillId: 'nope', level: 1, note: '' }] }), 400);
    expect(response.body).toEqual({
      statusCode: 400,
      message: 'Unknown skill: nope',
      error: 'Bad Request',
    });
  });

  it('rejects a level beyond the skill rubric', async () => {
    const response = await put(
      review({ ratings: [{ skillId: 'empathy', level: 5, note: '' }] }),
      400,
    );
    expect(response.body.message).toBe('Empathy & active listening has no level 5');
  });

  it('rejects a level outside the schema range', async () => {
    await put(review({ ratings: [{ skillId: 'empathy', level: 10, note: '' }] }), 400);
  });

  it('rejects an unknown behaviour', async () => {
    const response = await put(review({ behaviors: [{ behaviorId: 'nope', label: 'yes' }] }), 400);
    expect(response.body.message).toBe('Unknown behaviour: nope');
  });

  it('rejects a submission with no ratings', async () => {
    const response = await put(review({ coachName: 'Cara', ratings: [], submit: true }), 400);
    expect(response.body.message).toBe('Rate at least one skill before submitting');
  });

  it('rejects a submission whose only ratings are not-applicable', async () => {
    const ratings = [{ skillId: 'empathy', level: null, note: '' }];
    const response = await put(review({ coachName: 'Cara', ratings, submit: true }), 400);
    expect(response.body.message).toBe('Rate at least one skill before submitting');
  });

  it('stores a not-applicable rating as a null level', async () => {
    const ratings = [
      { skillId: 'empathy', level: 3, note: '' },
      { skillId: 'security', level: null, note: 'No account access on this call' },
    ];
    // Saved as a draft so it does not become ground truth for the tests that follow.
    const saved = await put(review({ callId: 'call-1001', coachName: 'Dee', ratings }), 200);
    expect((saved.body as CoachReview).ratings).toEqual(ratings);
  });

  it('rejects a review of an unknown call', async () => {
    const response = await put(review({ callId: 'call-nope' }), 404);
    expect(response.body.message).toBe('Call not found');
  });

  it('requires a call id to list reviews', async () => {
    await request(ctx.http).get('/api/reviews').expect(400);
  });
});

describe('validation report', () => {
  it('compares the submitted review with the AI evaluation', async () => {
    const result = await report();
    expect(result).toMatchObject({
      submittedReviews: 1,
      reviewedCalls: 1,
      totalCalls: 9,
      coaches: ['Ana'],
      humanBaseline: null,
    });
    expect(result.providers).toHaveLength(1);
    const [gemini] = result.providers;
    // Pairs (coach, AI): empathy (3, 3) and accuracy (1, 3).
    // kappa: observed disagreement w(1,3) = 4/16; expected 1 x 2/2 x (4/16 + 0) -> 0.
    expect(gemini).toMatchObject({
      provider: 'gemini',
      model: 'gemini-decision-1',
      calls: 1,
      all: { n: 2, exact: 0.5, adjacent: 0.5, mae: 1, bias: 1, qwk: 0 },
      // Coach overall (20 x 75 + 20 x 25) / 40 = 50 against the AI's 75.
      overall: { n: 1, mae: 25, bias: 25 },
      // The AI detected both behaviours; the coach saw only the first.
      behaviors: { n: 2, agreement: 0.5, precision: 0.5, recall: 1 },
    });
    expect(gemini!.disagreements).toEqual([
      expect.objectContaining({
        callId: 'call-1003',
        coachName: 'Ana',
        skillId: 'accuracy',
        coachLevel: 1,
        aiLevel: 3,
      }),
    ]);
  });

  it('shows agreement on the run that scored the reviewed call', async () => {
    const runs = (await request(ctx.http).get('/api/runs').expect(200)).body as RunSummary[];
    expect(runs.find((run) => run.id === runId)!.metrics.agreement).toEqual({
      n: 2,
      exact: 0.5,
      adjacent: 0.5,
      mae: 1,
      bias: 1,
      qwk: 0,
    });
  });

  it('adds a human baseline once a second coach rates the same call', async () => {
    await put(
      review({
        coachName: 'Ben',
        ratings: [
          { skillId: 'empathy', level: 2, note: '' },
          { skillId: 'accuracy', level: 1, note: '' },
        ],
        submit: true,
      }),
      200,
    );
    const result = await report();
    expect(result.coaches).toEqual(['Ana', 'Ben']);
    // Ana vs Ben: empathy (3, 2), accuracy (1, 1).
    expect(result.humanBaseline).toEqual({
      n: 2,
      exact: 0.5,
      adjacent: 1,
      mae: 0.5,
      bias: -0.5,
      qwk: 0.667,
    });
  });
});

describe('review queue', () => {
  it('puts unreviewed calls the AI is unsure about first and reviewed calls last', async () => {
    const queue = (await request(ctx.http).get('/api/reviews/queue').expect(200))
      .body as ReviewQueueItem[];
    expect(queue).toHaveLength(9);
    expect(queue[0]).toMatchObject({
      callId: 'call-1001',
      submittedReviews: 0,
      aiNeedsReview: true,
      aiConfidence: expect.any(Number),
    });
    expect(queue.at(-1)).toMatchObject({
      callId: 'call-1003',
      submittedReviews: 2,
      coaches: ['Ana', 'Ben'],
    });
    const priority = (item: ReviewQueueItem) =>
      (item.submittedReviews === 0 ? 0 : 10) +
      (item.aiNeedsReview ? 0 : 1) +
      (item.aiConfidence ?? 1);
    const priorities = queue.map(priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('never reveals the AI score in the queue', async () => {
    const queue = (await request(ctx.http).get('/api/reviews/queue').expect(200)).body;
    expect(JSON.stringify(queue)).not.toContain('overallScore');
  });
});
