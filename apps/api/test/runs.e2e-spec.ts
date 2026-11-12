import {
  estimateProviderCostUsd,
  PROVIDERS,
  type CallDetail,
  type CallSummary,
  type RunDetail,
  type ScoringProvider,
} from '@scorecard/domain';
import request from 'supertest';
import { createTestApp, waitFor, type TestApp } from './test-app.js';

const MODELS: Readonly<Record<ScoringProvider, string>> = {
  gemini: PROVIDERS.gemini.model,
  openai: 'gpt-6-luna-fake',
  jev: 'jev-fake',
};

const KEYS: Readonly<Record<ScoringProvider, string>> = {
  gemini: 'test-gemini-key',
  openai: 'test-openai-key',
  jev: 'test-jev-key',
};

const startRun = async (ctx: TestApp, body: object): Promise<RunDetail> => {
  const response = await request(ctx.http).post('/api/runs').send(body).expect(202);
  return response.body as RunDetail;
};

const finished = (ctx: TestApp, runId: string): Promise<RunDetail> =>
  waitFor(
    async () => (await request(ctx.http).get(`/api/runs/${runId}`).expect(200)).body as RunDetail,
    (run) => run.status !== 'queued' && run.status !== 'running',
  );

describe('batch runs', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('accepts a run and returns it before scoring finishes', async () => {
    const run = await startRun(ctx, { provider: 'gemini', callIds: ['call-1003'] });
    expect(run).toMatchObject({ kind: 'batch', provider: 'gemini', total: 1, scorecardVersion: 1 });
    expect(['queued', 'running', 'completed']).toContain(run.status);
    await finished(ctx, run.id);
  });

  it.each([
    ['gemini', 'call-1001'],
    ['openai', 'call-1002'],
    ['jev', 'call-1004'],
  ] as const)('scores a call to completion with %s', async (provider, callId) => {
    const before = ctx.fakes.requestsFor(provider).length;
    const run = await finished(ctx, (await startRun(ctx, { provider, callIds: [callId] })).id);
    expect(run).toMatchObject({ status: 'completed', total: 1, completed: 1, failed: 0 });
    expect(run.results).toEqual([
      { callId, subject: expect.any(String), status: 'completed', overallScore: 75, error: null },
    ]);

    const sent = ctx.fakes.requestsFor(provider).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.rawBody).not.toContain(KEYS[provider]);
    expect(JSON.stringify(sent[0]!.headers)).toContain(KEYS[provider]);

    const detail = (
      await request(ctx.http).get(`/api/calls/${callId}?provider=${provider}`).expect(200)
    ).body as CallDetail;
    expect(detail.evaluation).toMatchObject({
      callId,
      runId: run.id,
      provider,
      model: MODELS[provider],
      stage: 'final',
      methodVersion: 'moments-1',
      scorecardVersionId: 'support-quality-v1',
      turnCount: detail.transcript.length,
      channels: ['verbal'],
      overallScore: 75,
      usage: { requests: 1, inputTokens: 1000, outputTokens: 10 },
    });
  });

  it('persists the full evaluation document', async () => {
    const detail = (await request(ctx.http).get('/api/calls/call-1001?provider=gemini').expect(200))
      .body as CallDetail;
    const evaluation = detail.evaluation!;
    expect(evaluation.skills.map((skill) => [skill.skillId, skill.assessed])).toEqual([
      ['empathy', true],
      ['accuracy', true],
      ['security', true],
      ['resolution', true],
      ['communication', true],
      ['vocal_delivery', false],
      ['visual_presence', false],
    ]);
    // The fake answers every gate 0.8 and every rubric one level below the top.
    expect(evaluation.skills[0]).toMatchObject({
      level: 3,
      expectedLevel: 3,
      normalizedScore: 75,
      observability: 0.8,
    });
    // Unassessed media skills drop out of coverage: the verbal skills are 80% observable.
    expect(evaluation.coverage).toBe(0.8);
    expect(evaluation.risk).toMatchObject({ level: 2, label: 'Elevated' });
    expect(evaluation.journey).not.toBeNull();
    expect(evaluation.moments.length).toBeGreaterThan(0);
    expect(evaluation.usage.questions).toBeGreaterThan(0);
    expect(detail.evaluations.map((summary) => summary.provider)).toEqual(['gemini']);
  });

  it('records the request ledger and run metrics', async () => {
    const run = await finished(
      ctx,
      (await startRun(ctx, { provider: 'jev', callIds: ['call-1003', 'call-1005'] })).id,
    );
    expect(run.status).toBe('completed');
    expect(run.metrics).toMatchObject({
      evaluations: 2,
      averageScore: 75,
      requests: 2,
      inputTokens: 2000,
      outputTokens: 20,
      latencyP50Ms: expect.any(Number),
      latencyP95Ms: expect.any(Number),
      agreement: null,
    });
    expect(run.metrics.questions).toBeGreaterThan(0);
    expect(run.metrics.estimatedCostUsd).toBeCloseTo(estimateProviderCostUsd('jev', 2000, 20), 12);
    expect(run.startedAt).not.toBeNull();
    expect(run.completedAt).not.toBeNull();

    const list = (await request(ctx.http).get('/api/runs').expect(200)).body as RunDetail[];
    expect(list.map((item) => item.id)).toContain(run.id);
    expect(list.every((item) => item.kind === 'batch')).toBe(true);
  });

  it('marks scored calls completed in the call list', async () => {
    const calls = (await request(ctx.http).get('/api/calls').expect(200)).body as CallSummary[];
    const call = calls.find((item) => item.id === 'call-1003')!;
    expect(call.status).toBe('completed');
    expect(call.latest).toMatchObject({ provider: 'jev', overallScore: 75, scorecardVersion: 1 });
  });

  it('records a provider failure per call with a redacted message', async () => {
    ctx.fakes.fail('openai', 500, { error: { message: 'echo test-openai-key BODY-MARKER' } });
    try {
      const run = await finished(
        ctx,
        (await startRun(ctx, { provider: 'openai', callIds: ['call-1008'] })).id,
      );
      expect(run).toMatchObject({ status: 'failed', completed: 1, failed: 1 });
      expect(run.results[0]).toMatchObject({
        callId: 'call-1008',
        status: 'failed',
        overallScore: null,
        error: 'OpenAI Decisions request failed (HTTP 500)',
      });
      expect(run.metrics).toMatchObject({ requests: 1, evaluations: 0, latencyP50Ms: null });

      const calls = (await request(ctx.http).get('/api/calls').expect(200)).body as CallSummary[];
      expect(calls.find((item) => item.id === 'call-1008')).toMatchObject({
        status: 'failed',
        error: 'OpenAI Decisions request failed (HTTP 500)',
      });
      expect(JSON.stringify(calls)).not.toContain('BODY-MARKER');
    } finally {
      ctx.fakes.recover('openai');
    }
  });

  it('rejects unknown call ids before creating a run', async () => {
    const response = await request(ctx.http)
      .post('/api/runs')
      .send({ provider: 'gemini', callIds: ['call-1003', 'call-nope'] })
      .expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      message: 'Unknown call IDs: call-nope',
      error: 'Bad Request',
    });
  });

  it('rejects an unknown provider', async () => {
    await request(ctx.http).post('/api/runs').send({ provider: 'acme' }).expect(400);
  });

  it('returns 404 for an unknown run', async () => {
    await request(ctx.http).get('/api/runs/run-nope').expect(404);
  });
});

describe('a provider without a key', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({ keys: { gemini: 'test-gemini-key' } });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('is reported as unconfigured by health', async () => {
    const response = await request(ctx.http).get('/api/health').expect(200);
    expect(response.body.providers).toEqual({ gemini: true, openai: false, jev: false });
  });

  it('answers a batch run with 503 and creates nothing', async () => {
    const response = await request(ctx.http)
      .post('/api/runs')
      .send({ provider: 'openai', callIds: ['call-1003'] })
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      message: 'OPENAI_API_KEY is not configured on the API server',
      error: 'Service Unavailable',
    });
    expect((await request(ctx.http).get('/api/runs').expect(200)).body).toEqual([]);
    expect(ctx.fakes.requests).toEqual([]);
  });

  it('answers a live session with 503', async () => {
    const response = await request(ctx.http)
      .post('/api/live')
      .send({ callId: 'call-1003', provider: 'jev' })
      .expect(503);
    expect(response.body.message).toBe('JEV_API_KEY is not configured on the API server');
  });
});
