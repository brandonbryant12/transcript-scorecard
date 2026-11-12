import { PROVIDERS } from '@scorecard/domain';
import {
  failingFetch,
  jsonResponse,
  scriptedFetch,
  textResponse,
  type CapturedRequest,
} from '../../../test/fake-fetch.js';
import { API_KEY, BODY_MARKER, expectProviderError } from '../../../test/provider-assertions.js';
import type { DecisionInput, Questions } from '../decision.types.js';
import { JevAdapter } from './jev.adapter.js';

const questions: Questions = {
  yes_no: { type: 'noul', instructions: 'Did the employee greet the customer?' },
  pick: {
    type: 'choice',
    instructions: 'Which emotion?',
    options: { calm: 'Calm and steady', angry: 'Visibly angry' },
  },
  rate: { type: 'score', instructions: 'Rate empathy', levels: ['Low', 'Mid', 'High'] },
};

const goodAnswers = {
  yes_no: { type: 'noul', noul: 0.9 },
  pick: {
    type: 'choice',
    choice: 'calm',
    confidence: 0.7,
    probabilities: { calm: 0.7, angry: 0.3 },
  },
  rate: { type: 'score', score: 2, confidence: 0.8, probabilities: { '0': 0, '1': 0.2, '2': 0.8 } },
};

const body = (answers: Record<string, unknown> = goodAnswers) => ({
  model: 'jev-2026-09',
  answers,
  usage: { input_tokens: 700, output_tokens: 30 },
});

const adapterWith = (respond: (request: CapturedRequest) => Response | Promise<Response>) => {
  const fake = scriptedFetch(respond);
  return { adapter: new JevAdapter(fake.fetch), requests: fake.requests, fetch: fake.fetch };
};

const decide = (adapter: JevAdapter, input: DecisionInput = 'transcript text') =>
  adapter.decide({ input, questions, apiKey: API_KEY });

describe('JevAdapter request', () => {
  it('posts to the JEV endpoint with a bearer token and the input as `state`', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(body()));
    await decide(adapter);
    expect(requests[0]!.url).toBe(PROVIDERS.jev.endpoint);
    expect(requests[0]!.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(requests[0]!.body).toEqual({
      model: PROVIDERS.jev.model,
      state: 'transcript text',
      questions: {
        yes_no: { type: 'noul', instructions: 'Did the employee greet the customer?' },
        pick: {
          type: 'choice',
          instructions: 'Which emotion?',
          criteria: { calm: 'Calm and steady', angry: 'Visibly angry' },
        },
        rate: { type: 'score', instructions: 'Rate empathy', criteria: ['Low', 'Mid', 'High'] },
      },
    });
    expect(requests[0]!.rawBody).not.toContain(API_KEY);
  });

  it('refuses media input before calling the provider', async () => {
    const { adapter, fetch } = adapterWith(() => jsonResponse(body()));
    await expectProviderError(
      decide(adapter, [{ type: 'image', data: '/9j/4A==', mimeType: 'image/jpeg' }]),
      'rejected',
      /media input is not supported/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('JevAdapter answers', () => {
  it('derives yes/no confidence, keeps the reported model and maps usage', async () => {
    const { adapter } = adapterWith(() => jsonResponse(body()));
    const result = await decide(adapter);
    expect(result.model).toBe('jev-2026-09');
    expect(result.answers.yes_no).toEqual({ type: 'noul', probability: 0.9, confidence: 0.9 });
    expect(result.answers.pick).toEqual(goodAnswers.pick);
    expect(result.answers.rate).toEqual({
      type: 'score',
      score: 2,
      confidence: 0.8,
      probabilities: [0, 0.2, 0.8],
    });
    expect(result).toMatchObject({ inputTokens: 700, outputTokens: 30 });
  });
});

describe('JevAdapter failures', () => {
  const secretBody = { error: `${API_KEY} ${BODY_MARKER}` };

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [502, 'http'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, status));
    await expectProviderError(decide(adapter), kind);
  });

  it('rejects a success response that is not JSON', async () => {
    const { adapter } = adapterWith(() => textResponse(BODY_MARKER));
    await expectProviderError(decide(adapter), 'invalid_response', /body was not JSON/);
  });

  it('rejects a response without usage as a schema mismatch', async () => {
    const { adapter } = adapterWith(() => jsonResponse({ model: 'jev', answers: goodAnswers }));
    await expectProviderError(decide(adapter), 'invalid_response', /schema mismatch/);
  });

  it('rejects a response missing an answer', async () => {
    const { rate: _omitted, ...rest } = goodAnswers;
    const { adapter } = adapterWith(() => jsonResponse(body(rest)));
    await expectProviderError(decide(adapter), 'invalid_response', /an answer is missing/);
  });

  it('rejects an answer of the wrong type', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(body({ ...goodAnswers, yes_no: goodAnswers.rate })),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /wrong type/);
  });

  it('rejects a negative score', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(body({ ...goodAnswers, rate: { ...goodAnswers.rate, score: -0.5 } })),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /outside its rubric/);
  });

  it('rejects a choice that is not one of the options', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(body({ ...goodAnswers, pick: { ...goodAnswers.pick, choice: 'bored' } })),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /not one of the options/);
  });

  it('maps an abort to a timeout error', async () => {
    const adapter = new JevAdapter(failingFetch(new DOMException('aborted', 'AbortError')));
    await expectProviderError(decide(adapter), 'timeout', 'JEV request timed out');
  });
});
