import {
  defaultScorecard,
  type ActiveScorecard,
  type ScorecardDefinition,
} from '@scorecard/domain';
import request from 'supertest';
import { createTestApp, type TestApp } from './test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.app.close();
});

describe('GET /api/health', () => {
  it('reports the configured providers and the real-time model without exposing keys', async () => {
    const response = await request(ctx.http).get('/api/health').expect(200);
    expect(response.body).toEqual({
      ok: true,
      defaultProvider: 'gemini',
      providers: { gemini: true, openai: true, jev: true },
      realtime: { available: true, model: 'fake-live-model', envVar: 'GEMINI_API_KEY' },
    });
    expect(JSON.stringify(response.body)).not.toContain('test-gemini-key');
  });
});

describe('calls', () => {
  it('lists the seeded calls, newest first, none scored yet', async () => {
    const response = await request(ctx.http).get('/api/calls').expect(200);
    const ids = response.body.map((call: { id: string }) => call.id);
    expect(ids).toHaveLength(9);
    expect(ids).toEqual(expect.arrayContaining(['call-1001', 'call-1003', 'call-1009']));
    const started = response.body.map((call: { startedAt: string }) => call.startedAt);
    expect(started).toEqual([...started].sort().reverse());
    expect(response.body[0]).toMatchObject({
      source: 'seed',
      status: 'pending',
      latest: null,
      submittedReviews: 0,
      error: null,
    });
  });

  it('returns a call with its transcript', async () => {
    const response = await request(ctx.http).get('/api/calls/call-1003').expect(200);
    expect(response.body).toMatchObject({
      id: 'call-1003',
      subject: 'Change delivery address',
      turnCount: 7,
      evaluation: null,
      evaluations: [],
    });
    expect(response.body.transcript).toHaveLength(7);
    expect(response.body.transcript[0]).toMatchObject({ id: 'turn-1', speaker: 'employee' });
  });

  it('serves the transcript on its own, with nothing an evaluation would add', async () => {
    const response = await request(ctx.http).get('/api/calls/call-1003/transcript').expect(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'agentName',
      'customerName',
      'durationSeconds',
      'id',
      'startedAt',
      'subject',
      'transcript',
    ]);
    expect(response.body.transcript).toHaveLength(7);
    await request(ctx.http).get('/api/calls/nope/transcript').expect(404);
  });

  it('returns 404 for an unknown call', async () => {
    const response = await request(ctx.http).get('/api/calls/call-nope').expect(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: 'Call not found',
      error: 'Not Found',
    });
  });

  it('rejects an unknown provider filter', async () => {
    await request(ctx.http).get('/api/calls/call-1003?provider=acme').expect(400);
  });
});

describe('scorecard', () => {
  const edited = (): ScorecardDefinition => ({
    ...defaultScorecard,
    skills: defaultScorecard.skills.map((skill) =>
      skill.id === 'empathy' ? { ...skill, weight: 30 } : skill,
    ),
  });

  it('starts at version 1 of the default scorecard', async () => {
    const response = await request(ctx.http).get('/api/scorecard').expect(200);
    const scorecard = response.body as ActiveScorecard;
    expect(scorecard).toMatchObject({ version: 1, id: 'support-quality-v1' });
    expect(scorecard.definition).toEqual(defaultScorecard);
    expect(scorecard.versions.map((version) => version.version)).toEqual([1]);
  });

  it('publishes an edit as version 2', async () => {
    const response = await request(ctx.http).put('/api/scorecard').send(edited()).expect(200);
    expect(response.body).toMatchObject({ version: 2, id: 'support-quality-v2' });
    expect(response.body.definition.skills[0].weight).toBe(30);
    expect(response.body.versions.map((version: { version: number }) => version.version)).toEqual([
      2, 1,
    ]);
  });

  it('publishes nothing for an unchanged definition', async () => {
    const response = await request(ctx.http).put('/api/scorecard').send(edited()).expect(200);
    expect(response.body.version).toBe(2);
    expect(response.body.versions).toHaveLength(2);
  });

  it('rejects a definition with an unknown key in Nest error shape', async () => {
    const response = await request(ctx.http)
      .put('/api/scorecard')
      .send({ ...edited(), colour: 'blue' })
      .expect(400);
    expect(response.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(response.body.message).toBeDefined();
  });

  it('rejects a skill with a single rubric level', async () => {
    const definition = edited();
    const response = await request(ctx.http)
      .put('/api/scorecard')
      .send({
        ...definition,
        skills: definition.skills.map((skill, index) =>
          index === 0 ? { ...skill, levels: skill.levels.slice(0, 1) } : skill,
        ),
      })
      .expect(400);
    expect(response.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
  });

  it('rejects cross-field problems with the problem list as the message', async () => {
    const definition = edited();
    const response = await request(ctx.http)
      .put('/api/scorecard')
      .send({ ...definition, skills: [...definition.skills, definition.skills[0]] })
      .expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      message: expect.arrayContaining(['Skill id "empathy" is used more than once']),
      error: 'Bad Request',
    });
    const after = await request(ctx.http).get('/api/scorecard').expect(200);
    expect(after.body.version).toBe(2);
  });
});

describe('GET /api/practice/scenarios', () => {
  it('lists scenarios without the private customer brief', async () => {
    const response = await request(ctx.http).get('/api/practice/scenarios').expect(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0]).toEqual({
      id: expect.any(String),
      title: expect.any(String),
      summary: expect.any(String),
      customerName: expect.any(String),
      subject: expect.any(String),
    });
  });
});
