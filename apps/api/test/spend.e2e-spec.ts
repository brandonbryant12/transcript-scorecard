import {
  estimateProviderCostUsd,
  PROVIDERS,
  type LiveSessionDetail,
  type RunDetail,
  type RunSummary,
  type ScoringProvider,
  type SpendKind,
  type SpendSummary,
  type SpendTotals,
} from '@scorecard/domain';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ProviderRequestEntity } from '../src/runs/provider-request.entity.js';
import { createTestApp, waitFor, type TestApp } from './test-app.js';

// The fakes report 1,000 input and 10 output tokens for every successful request.
const IN = 1_000;
const OUT = 10;

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.app.close();
});

const spend = async (query = ''): Promise<SpendSummary> =>
  (await request(ctx.http).get(`/api/spend${query}`).expect(200)).body as SpendSummary;

const finishedRun = async (body: object): Promise<RunDetail> => {
  const started = (await request(ctx.http).post('/api/runs').send(body).expect(202))
    .body as RunDetail;
  return waitFor(
    async () =>
      (await request(ctx.http).get(`/api/runs/${started.id}`).expect(200)).body as RunDetail,
    (run) => run.status !== 'queued' && run.status !== 'running',
  );
};

const session = async (id: string): Promise<LiveSessionDetail> =>
  (await request(ctx.http).get(`/api/live/${id}`).expect(200)).body as LiveSessionDetail;

const settled = (id: string): Promise<LiveSessionDetail> =>
  waitFor(
    () => session(id),
    (detail) => detail.status === 'completed' || detail.status === 'failed',
    { timeoutMs: 15_000 },
  );

const control = (id: string, body: object) =>
  request(ctx.http).post(`/api/live/${id}/control`).send(body).expect(200);

// A stream with four turns, ended so it gets its final pass.
const streamCall = async (subject: string): Promise<LiveSessionDetail> => {
  const created = (
    await request(ctx.http)
      .post('/api/live/stream')
      .send({ subject, customerName: 'Sam', agentName: 'Alex', provider: 'jev' })
      .expect(201)
  ).body as LiveSessionDetail;
  const turns = [
    ['employee', 'Thanks for calling, this is Alex. How can I help?'],
    ['customer', 'I was charged twice for my subscription this month.'],
    ['employee', 'I am sorry about that. Let me check the account for you.'],
    ['customer', 'Thank you, I just want the duplicate charge refunded.'],
  ];
  for (const [speaker, text] of turns) {
    await request(ctx.http)
      .post(`/api/live/${created.id}/turns`)
      .send({ speaker, text })
      .expect(201);
  }
  await control(created.id, { action: 'end' });
  return settled(created.id);
};

const costOf = (provider: ScoringProvider, okRequests: number): number =>
  estimateProviderCostUsd(provider, okRequests * IN, okRequests * OUT);

const expectTotals = (actual: SpendTotals, expected: SpendTotals): void => {
  const { estimatedCostUsd, ...counts } = expected;
  expect(actual).toMatchObject(counts);
  expect(actual.estimatedCostUsd).toBeCloseTo(estimatedCostUsd, 12);
};

describe('GET /api/spend on an empty ledger', () => {
  it('reports the price list and zero spending', async () => {
    const summary = await spend();
    const zero = {
      requests: 0,
      failedRequests: 0,
      questions: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    expect(summary.today).toBe(new Date().toISOString().slice(0, 10));
    expect(summary.days).toBe(30);
    expect(summary.totals).toEqual({ allTime: zero, today: zero, last7Days: zero });
    expect(summary.byProvider.map((line) => line.provider)).toEqual(['gemini', 'openai', 'jev']);
    expect(summary.byKind.map((line) => line.kind)).toEqual([
      'batch',
      'replay',
      'stream',
      'practice',
    ]);
    expect(summary.byKind.every((line) => line.requests === 0)).toBe(true);
    expect(summary.byDay).toEqual([]);
    expect(summary.recent).toEqual([]);
    expect(summary.prices).toEqual(
      (['gemini', 'openai', 'jev'] as const).map((provider) => ({
        provider,
        label: PROVIDERS[provider].label,
        model: PROVIDERS[provider].model,
        inputUsdPerMillion: PROVIDERS[provider].pricing.inputUsdPerMillion,
        outputUsdPerMillion: PROVIDERS[provider].pricing.outputUsdPerMillion,
        sourceUrl: PROVIDERS[provider].pricing.sourceUrl,
        checkedAt: PROVIDERS[provider].pricing.checkedAt,
      })),
    );
    expect(summary.excluded.join(' ')).toContain('voice model');
  });
});

describe('GET /api/spend after scoring', () => {
  let jevBatch: RunDetail;
  let replayRequests: number;
  let streamRequests: number;
  let practiceRequests: number;

  beforeAll(async () => {
    // Batch work: two JEV calls, one Gemini call, and one OpenAI call that fails.
    jevBatch = await finishedRun({ provider: 'jev', callIds: ['call-1003', 'call-1005'] });
    await finishedRun({ provider: 'gemini', callIds: ['call-1004'] });
    ctx.fakes.fail('openai', 500, { error: { message: 'unavailable' } });
    try {
      await finishedRun({ provider: 'openai', callIds: ['call-1008'] });
    } finally {
      ctx.fakes.recover('openai');
    }

    // A replay that is then reset: the session moves to a new run, and the old run's
    // requests must still count as replay work.
    const replay = (
      await request(ctx.http)
        .post('/api/live')
        .send({ callId: 'call-1003', provider: 'gemini', intervalMs: 250, scoreEveryTurns: 3 })
        .expect(201)
    ).body as LiveSessionDetail;
    await control(replay.id, { action: 'start' });
    replayRequests = (await settled(replay.id)).totals.requests;
    await control(replay.id, { action: 'reset' });

    streamRequests = (await streamCall('Refund for a cancelled order')).totals.requests;
    practiceRequests = (await streamCall('Practice · Duplicate subscription charge')).totals
      .requests;
  }, 60_000);

  it('totals every request, with the failed one counted but free', async () => {
    const summary = await spend();
    const gemini = ctx.fakes.requestsFor('gemini').length;
    const jev = ctx.fakes.requestsFor('jev').length;
    const ok = gemini + jev;
    const expected = {
      requests: ok + 1,
      failedRequests: 1,
      questions: summary.totals.allTime.questions,
      inputTokens: ok * IN,
      outputTokens: ok * OUT,
      estimatedCostUsd: costOf('gemini', gemini) + costOf('jev', jev),
    };
    expect(summary.totals.allTime.questions).toBeGreaterThan(0);
    expectTotals(summary.totals.allTime, expected);
    // Everything happened just now.
    expect(summary.totals.today).toEqual(summary.totals.allTime);
    expect(summary.totals.last7Days).toEqual(summary.totals.allTime);
    expect(summary.byDay).toEqual([{ day: summary.today, ...summary.totals.allTime }]);
  });

  it('breaks spending down by provider', async () => {
    const summary = await spend();
    const line = (provider: ScoringProvider) =>
      summary.byProvider.find((item) => item.provider === provider)!;
    const gemini = ctx.fakes.requestsFor('gemini').length;
    const jev = ctx.fakes.requestsFor('jev').length;
    expect(line('openai')).toEqual({
      provider: 'openai',
      requests: 1,
      failedRequests: 1,
      questions: expect.any(Number),
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    });
    expect(line('gemini')).toMatchObject({ requests: gemini, failedRequests: 0 });
    expect(line('gemini').estimatedCostUsd).toBeCloseTo(costOf('gemini', gemini), 12);
    expect(line('jev')).toMatchObject({ requests: jev, inputTokens: jev * IN });
    expect(line('jev').estimatedCostUsd).toBeCloseTo(costOf('jev', jev), 12);
  });

  it('breaks spending down by kind of work', async () => {
    const summary = await spend();
    const requests = Object.fromEntries(summary.byKind.map((line) => [line.kind, line.requests]));
    // Two JEV calls, one Gemini call and the failed OpenAI call, one request each.
    expect(requests).toEqual({
      batch: 4,
      replay: replayRequests,
      stream: streamRequests,
      practice: practiceRequests,
    } satisfies Record<SpendKind, number>);
    expect(replayRequests).toBeGreaterThan(0);
    expect(streamRequests).toBeGreaterThan(0);
    expect(practiceRequests).toBeGreaterThan(0);
    const batch = summary.byKind.find((line) => line.kind === 'batch')!;
    expect(batch.failedRequests).toBe(1);
    expect(batch.estimatedCostUsd).toBeCloseTo(costOf('jev', 2) + costOf('gemini', 1), 12);
  });

  it('lists the most recent ledger rows, newest first', async () => {
    const summary = await spend();
    expect(summary.recent).toHaveLength(summary.totals.allTime.requests);
    const times = summary.recent.map((row) => row.startedAt);
    expect(times).toEqual([...times].sort().reverse());

    const failed = summary.recent.filter((row) => !row.ok);
    expect(failed).toEqual([
      expect.objectContaining({
        provider: 'openai',
        model: null,
        kind: 'batch',
        callId: 'call-1008',
        subject: expect.any(String),
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      }),
    ]);
    const practice = summary.recent.filter((row) => row.kind === 'practice');
    expect(practice).toHaveLength(practiceRequests);
    expect(practice[0]).toMatchObject({
      provider: 'jev',
      model: 'jev-fake',
      subject: 'Practice · Duplicate subscription charge',
      ok: true,
      inputTokens: IN,
      outputTokens: OUT,
    });
    expect(practice[0]!.questionCount).toBeGreaterThan(0);
    expect(practice[0]!.estimatedCostUsd).toBeCloseTo(costOf('jev', 1), 12);
  });

  it('reconciles with the per-run metrics', async () => {
    const summary = await spend();
    const runs = (await request(ctx.http).get('/api/runs').expect(200)).body as RunSummary[];
    const sum = (valueOf: (run: RunSummary) => number) =>
      runs.reduce((total, run) => total + valueOf(run), 0);
    expect(sum((run) => run.metrics.requests)).toBe(summary.totals.allTime.requests);
    expect(sum((run) => run.metrics.questions)).toBe(summary.totals.allTime.questions);
    expect(sum((run) => run.metrics.inputTokens)).toBe(summary.totals.allTime.inputTokens);
    expect(sum((run) => run.metrics.estimatedCostUsd)).toBeCloseTo(
      summary.totals.allTime.estimatedCostUsd,
      12,
    );
  });

  describe('older ledger rows', () => {
    const DAY = 86_400_000;
    // Noon UTC `daysBack` days ago, well clear of any day boundary.
    const noonUtc = (daysBack: number): string => {
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
          daysBack * DAY +
          DAY / 2,
      ).toISOString();
    };

    beforeAll(async () => {
      // Backdated copies of a real batch request: yesterday, three days ago, ten days ago.
      const ledger = ctx.app.get(DataSource).getRepository(ProviderRequestEntity);
      const template = await ledger.findOneByOrFail({ runId: jevBatch.id });
      const { id: _id, ...row } = template;
      await ledger.insert([1, 3, 10].map((daysBack) => ({ ...row, startedAt: noonUtc(daysBack) })));
    });

    it('counts a day from midnight UTC and the last 7 days as today and the six before', async () => {
      const summary = await spend();
      const one = estimateProviderCostUsd('jev', IN, OUT);
      expect(summary.totals.allTime.requests).toBe(summary.totals.today.requests + 3);
      expect(summary.totals.last7Days.requests).toBe(summary.totals.today.requests + 2);
      expect(summary.totals.last7Days.estimatedCostUsd).toBeCloseTo(
        summary.totals.today.estimatedCostUsd + 2 * one,
        12,
      );
      expect(summary.byDay.map((line) => [line.day, line.requests])).toEqual([
        [summary.today, summary.totals.today.requests],
        [noonUtc(1).slice(0, 10), 1],
        [noonUtc(3).slice(0, 10), 1],
        [noonUtc(10).slice(0, 10), 1],
      ]);
    });

    it('limits the per-day lines to the most recent active days', async () => {
      const summary = await spend('?days=2');
      expect(summary.days).toBe(2);
      expect(summary.byDay.map((line) => line.day)).toEqual([
        summary.today,
        noonUtc(1).slice(0, 10),
      ]);
      // The window only affects the per-day lines.
      expect(summary.totals.allTime.requests).toBe(summary.totals.today.requests + 3);
    });
  });
});

describe('GET /api/spend?days', () => {
  it.each([
    ['0', 'days must be at least 1'],
    ['366', 'days must be at most 365'],
    ['1.5', 'days must be a whole number'],
    ['abc', 'days must be a whole number'],
    ['-3', 'days must be a whole number'],
    ['', 'days must be a whole number'],
    ['7&days=8', 'days must be given once'],
  ])('rejects days=%s', async (days, message) => {
    const response = await request(ctx.http).get(`/api/spend?days=${days}`).expect(400);
    expect(response.body).toEqual({ statusCode: 400, message: [message], error: 'Bad Request' });
  });

  it('accepts the ends of the range', async () => {
    expect((await spend('?days=1')).days).toBe(1);
    expect((await spend('?days=365')).days).toBe(365);
  });
});
