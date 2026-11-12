import type { LiveSessionDetail, RunSummary } from '@scorecard/domain';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createTestApp, sleep, waitFor, type TestApp } from './test-app.js';

// Live sessions run on real timers at the minimum reveal interval (250 ms): the
// coordinator's setInterval and its database round trips do not mix well with fake
// timers, and a seven-turn call replays in under two seconds.

let ctx: TestApp;

beforeAll(async () => {
  // A real socket, for the Server-Sent Events client below.
  ctx = await createTestApp({ listen: true });
});

afterAll(async () => {
  await ctx.app.close();
});

const session = async (id: string): Promise<LiveSessionDetail> =>
  (await request(ctx.http).get(`/api/live/${id}`).expect(200)).body as LiveSessionDetail;

const control = async (id: string, body: object): Promise<LiveSessionDetail> =>
  (await request(ctx.http).post(`/api/live/${id}/control`).send(body).expect(200))
    .body as LiveSessionDetail;

const createReplay = async (body: object): Promise<LiveSessionDetail> =>
  (await request(ctx.http).post('/api/live').send(body).expect(201)).body as LiveSessionDetail;

const settled = (id: string) =>
  waitFor(
    () => session(id),
    (detail) => detail.status === 'completed' || detail.status === 'failed',
    { timeoutMs: 15_000 },
  );

describe('live replay', () => {
  let replay: LiveSessionDetail;
  let requestsBefore: number;

  beforeAll(async () => {
    replay = await createReplay({
      callId: 'call-1003',
      provider: 'gemini',
      intervalMs: 250,
      scoreEveryTurns: 2,
    });
  });

  it('is created ready, with nothing revealed', () => {
    expect(replay).toMatchObject({
      callId: 'call-1003',
      provider: 'gemini',
      source: 'replay',
      status: 'ready',
      revealedTurnCount: 0,
      totalTurns: 7,
      revealIntervalMs: 250,
      scoreEveryTurns: 2,
      transcript: [],
      evaluation: null,
      history: [],
    });
  });

  it('plays to completion with provisional passes and then a final one', async () => {
    requestsBefore = ctx.fakes.requests.length;
    const started = await control(replay.id, { action: 'start' });
    expect(started.status).toBe('playing');

    const done = await settled(replay.id);
    expect(done).toMatchObject({
      status: 'completed',
      revealedTurnCount: 7,
      scoredTurnCount: 7,
      pendingTurnCount: 0,
      elapsedMs: 7 * 250,
      error: null,
    });
    expect(done.transcript).toHaveLength(7);
    expect(done.evaluation).toMatchObject({ stage: 'final', turnCount: 7, runId: done.runId });

    const turnCounts = done.history.map((point) => point.turnCount);
    expect(turnCounts.length).toBeGreaterThanOrEqual(2);
    expect(turnCounts.at(-1)).toBe(7);
    expect(turnCounts.slice(0, -1).every((count) => count < 7)).toBe(true);

    const stages = done.requests.map((item) => item.stage);
    expect(stages.at(-1)).toBe('final');
    expect(stages.slice(0, -1).every((stage) => stage === 'provisional')).toBe(true);
    expect(done.requests.every((item) => item.ok)).toBe(true);
    expect(done.totals).toMatchObject({
      requests: done.requests.length,
      inputTokens: 1000 * done.requests.length,
    });
  }, 20_000);

  it('reads each turn only once across passes', () => {
    const keys = ctx.fakes.requests
      .slice(requestsBefore)
      .flatMap((sent) => Object.keys(sent.body.questions));
    const tagKeys = keys.filter((key) => key.startsWith('t_'));
    // call-1003 has four employee turns and the default scorecard 16 verbal behaviours.
    expect(tagKeys).toHaveLength(4 * 16);
    expect(new Set(tagKeys).size).toBe(tagKeys.length);
    expect(keys.filter((key) => /^c_\d+_s$/.test(key))).toHaveLength(3);
  });

  it('lists the live run among runs once it has made requests', async () => {
    const runs = (await request(ctx.http).get('/api/runs').expect(200)).body as RunSummary[];
    const live = runs.find((run) => run.kind === 'live' && run.id === replay.runId);
    expect(live).toMatchObject({ status: 'completed', completed: 1 });
  });

  it('resets to a new run with no turns', async () => {
    const before = await session(replay.id);
    const reset = await control(replay.id, { action: 'reset' });
    expect(reset.runId).not.toBe(before.runId);
    expect(reset).toMatchObject({
      status: 'ready',
      revealedTurnCount: 0,
      scoredTurnCount: 0,
      elapsedMs: 0,
      transcript: [],
      evaluation: null,
      history: [],
      requests: [],
    });
  });

  it('stops revealing turns while paused', async () => {
    const long = await createReplay({ callId: 'call-1009', intervalMs: 250, scoreEveryTurns: 25 });
    await control(long.id, { action: 'start' });
    await waitFor(
      () => session(long.id),
      (detail) => detail.revealedTurnCount >= 2,
    );
    const paced = await control(long.id, { action: 'pace', intervalMs: 500 });
    expect(paced.revealIntervalMs).toBe(500);
    const paused = await control(long.id, { action: 'pause' });
    expect(paused.status).toBe('paused');

    // Let any reveal already in flight land, then check nothing more arrives.
    await sleep(300);
    const first = (await session(long.id)).revealedTurnCount;
    await sleep(800);
    const second = await session(long.id);
    expect(second.revealedTurnCount).toBe(first);
    expect(second.status).toBe('paused');
    await control(long.id, { action: 'reset' });
  }, 15_000);

  it('refuses turns posted to a replay', async () => {
    const response = await request(ctx.http)
      .post(`/api/live/${replay.id}/turns`)
      .send({ speaker: 'customer', text: 'Hello' })
      .expect(409);
    expect(response.body).toEqual({
      statusCode: 409,
      message: 'This session is not an open stream',
      error: 'Conflict',
    });
  });

  it('returns 404 for an unknown call or session', async () => {
    await request(ctx.http).post('/api/live').send({ callId: 'call-nope' }).expect(404);
    await request(ctx.http).get('/api/live/live-nope').expect(404);
    await request(ctx.http)
      .post('/api/live/live-nope/control')
      .send({ action: 'start' })
      .expect(404);
  });

  it('rejects a reveal interval below the minimum', async () => {
    await request(ctx.http)
      .post('/api/live')
      .send({ callId: 'call-1003', intervalMs: 100 })
      .expect(400);
  });
});

describe('live stream', () => {
  it('scores turns as they arrive and produces a final evaluation on end', async () => {
    const created = await request(ctx.http)
      .post('/api/live/stream')
      .send({
        subject: 'Card charged twice',
        customerName: 'Maya',
        agentName: 'Jordan',
        provider: 'openai',
        scoreEveryTurns: 2,
      })
      .expect(201);
    const stream = created.body as LiveSessionDetail;
    expect(stream).toMatchObject({
      source: 'stream',
      status: 'playing',
      provider: 'openai',
      totalTurns: null,
      revealedTurnCount: 0,
    });

    const turns = [
      ['customer', 'My card was charged twice this month.'],
      ['employee', 'I am sorry about that. Let me look at your account.'],
      ['customer', 'Thank you, I need it fixed today.'],
      ['employee', 'I have refunded the duplicate charge; reference RF-1234.'],
    ] as const;
    for (const [index, [speaker, text]] of turns.entries()) {
      const response = await request(ctx.http)
        .post(`/api/live/${stream.id}/turns`)
        .send({ speaker, text, startSeconds: index * 10 })
        .expect(201);
      expect(response.body).toEqual({
        id: `turn-${index + 1}`,
        speaker,
        text,
        startSeconds: index * 10,
      });
    }

    const ended = await control(stream.id, { action: 'end' });
    expect(ended.totalTurns).toBe(4);
    const done = await settled(stream.id);
    expect(done.status).toBe('completed');
    expect(done.transcript).toHaveLength(4);
    expect(done.evaluation).toMatchObject({
      stage: 'final',
      turnCount: 4,
      provider: 'openai',
      model: 'gpt-6-luna-fake',
    });
    expect(done.requests.at(-1)!.stage).toBe('final');

    await request(ctx.http)
      .post(`/api/live/${stream.id}/turns`)
      .send({ speaker: 'customer', text: 'One more thing' })
      .expect(409);
  }, 15_000);

  it('rejects a blank turn', async () => {
    const created = await request(ctx.http)
      .post('/api/live/stream')
      .send({ subject: 'S', customerName: 'C', agentName: 'A' })
      .expect(201);
    await request(ctx.http)
      .post(`/api/live/${created.body.id}/turns`)
      .send({ speaker: 'customer', text: '   ' })
      .expect(400);
  });
});

describe('GET /api/live/:id/events', () => {
  it('opens with a snapshot of the session', async () => {
    const replay = await createReplay({ callId: 'call-1005' });
    const { port } = ctx.http.address() as AddressInfo;
    const first = await new Promise<{ contentType: string | undefined; data: LiveSessionDetail }>(
      (resolve, reject) => {
        const req = get(`http://127.0.0.1:${port}/api/live/${replay.id}/events`, (response) => {
          let buffer = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            buffer += chunk;
            const end = buffer.indexOf('\n\n');
            if (end === -1) return;
            const line = buffer
              .slice(0, end)
              .split('\n')
              .find((item) => item.startsWith('data: '));
            req.destroy();
            resolve({
              contentType: response.headers['content-type'],
              data: JSON.parse(line!.slice('data: '.length)) as LiveSessionDetail,
            });
          });
        });
        req.on('error', reject);
        req.setTimeout(5_000, () => req.destroy(new Error('No SSE event within 5 s')));
      },
    );
    expect(first.contentType).toContain('text/event-stream');
    expect(first.data).toMatchObject({ id: replay.id, status: 'ready', callId: 'call-1005' });
  });
});
