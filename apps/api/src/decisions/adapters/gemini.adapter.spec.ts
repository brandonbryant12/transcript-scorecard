import { Logger } from '@nestjs/common';
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
import { GeminiAdapter } from './gemini.adapter.js';

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
  yes_no: { type: 'noul', noul: 0.8, confidence: 0.75 },
  pick: {
    type: 'choice',
    choice: 'calm',
    confidence: 0.9,
    probabilities: { calm: 0.9, angry: 0.1 },
  },
  rate: {
    type: 'score',
    score: 1.2,
    legend: 'Mid',
    confidence: 0.7,
    probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 },
  },
};

const goodBody = (answers: Record<string, unknown> = goodAnswers) => ({
  answers,
  usage: { total_input_tokens: 1234, total_output_tokens: 56 },
});

const adapterWith = (respond: (request: CapturedRequest) => Response | Promise<Response>) => {
  const fake = scriptedFetch(respond);
  return { adapter: new GeminiAdapter(fake.fetch), requests: fake.requests };
};

const decide = (
  adapter: GeminiAdapter,
  input: DecisionInput = 'transcript text',
  asked: Questions = questions,
) => adapter.decide({ input, questions: asked, apiKey: API_KEY });

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeminiAdapter request', () => {
  it('posts to the Gemini Decisions endpoint with the key in x-goog-api-key', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(goodBody()));
    await decide(adapter);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(PROVIDERS.gemini.endpoint);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.headers).toEqual({
      'x-goog-api-key': API_KEY,
      'Content-Type': 'application/json',
    });
  });

  it('sends questions as a map keyed by name with criteria for choices and scores', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(goodBody()));
    await decide(adapter);
    expect(requests[0]!.body).toEqual({
      model: PROVIDERS.gemini.model,
      input: 'transcript text',
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
  });

  it('never puts the API key in the body', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(goodBody()));
    await decide(adapter);
    expect(requests[0]!.rawBody).not.toContain(API_KEY);
  });

  it('passes audio and image blocks with mime_type, images at low resolution', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(goodBody()));
    await decide(adapter, [
      { type: 'text', text: 'context' },
      { type: 'audio', data: 'UklGRg==', mimeType: 'audio/wav' },
      { type: 'image', data: '/9j/4A==', mimeType: 'image/jpeg' },
    ]);
    expect(requests[0]!.body.input).toEqual([
      { type: 'text', text: 'context' },
      { type: 'audio', data: 'UklGRg==', mime_type: 'audio/wav' },
      { type: 'image', data: '/9j/4A==', mime_type: 'image/jpeg', resolution: 'low' },
    ]);
  });
});

describe('GeminiAdapter answers', () => {
  it('normalises every answer type and maps usage', async () => {
    const { adapter } = adapterWith(() => jsonResponse(goodBody()));
    const result = await decide(adapter);
    expect(result).toEqual({
      model: PROVIDERS.gemini.model,
      answers: {
        yes_no: { type: 'noul', probability: 0.8, confidence: 0.75 },
        pick: {
          type: 'choice',
          choice: 'calm',
          confidence: 0.9,
          probabilities: { calm: 0.9, angry: 0.1 },
        },
        rate: { type: 'score', score: 1.2, confidence: 0.7, probabilities: [0.1, 0.6, 0.3] },
      },
      inputTokens: 1234,
      outputTokens: 56,
    });
  });

  it('derives a yes/no confidence when the response omits it', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(goodBody({ ...goodAnswers, yes_no: { type: 'noul', noul: 0.3 } })),
    );
    const result = await decide(adapter);
    expect(result.answers.yes_no).toEqual({ type: 'noul', probability: 0.3, confidence: 0.7 });
  });

  it('fills rubric levels missing from the probability map with zero, in level order', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        goodBody({
          ...goodAnswers,
          rate: { type: 'score', score: 2, confidence: 0.9, probabilities: { '2': 0.9, '0': 0.1 } },
        }),
      ),
    );
    const result = await decide(adapter);
    expect(result.answers.rate).toMatchObject({ probabilities: [0.1, 0, 0.9] });
  });

  it('reports zero output tokens when usage omits them', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse({ answers: goodAnswers, usage: { total_input_tokens: 10 } }),
    );
    expect((await decide(adapter)).outputTokens).toBe(0);
  });
});

describe('GeminiAdapter failures', () => {
  const secretBody = { error: { message: `upstream echoed ${API_KEY} ${BODY_MARKER}` } };

  it.each([401, 403])('maps HTTP %i to an auth error', async (status) => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, status));
    await expectProviderError(
      decide(adapter),
      'auth',
      'Gemini Decisions rejected the API credentials',
    );
  });

  it('maps HTTP 429 to a rate limit error', async () => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, 429));
    await expectProviderError(decide(adapter), 'rate_limit');
  });

  it.each([500, 503])('maps HTTP %i to an http error naming only the status', async (status) => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, status));
    await expectProviderError(
      decide(adapter),
      'http',
      `Gemini Decisions request failed (HTTP ${status})`,
    );
  });

  it('maps a safety block to a blocked error', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse({ error: { code: 'safety', message: BODY_MARKER } }, 400),
    );
    await expectProviderError(decide(adapter), 'blocked');
  });

  it('maps a 400 that mentions the API key to an auth error', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        { error: { code: 'INVALID_ARGUMENT', message: `API key not valid: ${API_KEY}` } },
        400,
      ),
    );
    await expectProviderError(decide(adapter), 'auth');
  });

  it('maps any other 400 to a rejected error and keeps the detail out of the message', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        { error: { code: 'INVALID_ARGUMENT', message: `too many questions ${BODY_MARKER}` } },
        400,
      ),
    );
    await expectProviderError(
      decide(adapter),
      'rejected',
      'Gemini Decisions rejected the request (HTTP 400)',
    );
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('rejects a success response that is not JSON', async () => {
    const { adapter } = adapterWith(() => textResponse(`<html>${BODY_MARKER}</html>`));
    await expectProviderError(decide(adapter), 'invalid_response', /body was not JSON/);
  });

  it('rejects a response that does not match the wire schema', async () => {
    const { adapter } = adapterWith(() => jsonResponse({ result: BODY_MARKER }));
    await expectProviderError(decide(adapter), 'invalid_response', /schema mismatch/);
  });

  it('rejects a probability outside 0..1 as a schema mismatch', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(goodBody({ ...goodAnswers, yes_no: { type: 'noul', noul: 1.5 } })),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /schema mismatch/);
  });

  it('rejects a response missing an answer', async () => {
    const { pick: _omitted, ...rest } = goodAnswers;
    const { adapter } = adapterWith(() => jsonResponse(goodBody(rest)));
    await expectProviderError(decide(adapter), 'invalid_response', /an answer is missing/);
  });

  it('rejects an answer of the wrong type', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(goodBody({ ...goodAnswers, rate: { type: 'noul', noul: 0.5 } })),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /wrong type/);
  });

  it('rejects a score outside the rubric', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        goodBody({
          ...goodAnswers,
          rate: { type: 'score', score: 3, confidence: 0.5, probabilities: { '2': 1 } },
        }),
      ),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /outside its rubric/);
  });

  it('rejects a choice that is not one of the options', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        goodBody({
          ...goodAnswers,
          pick: { type: 'choice', choice: 'elated', confidence: 0.9, probabilities: { calm: 1 } },
        }),
      ),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /not one of the options/);
  });

  it('rejects a choice distribution that names an unknown option', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        goodBody({
          ...goodAnswers,
          pick: { type: 'choice', choice: 'calm', confidence: 0.9, probabilities: { elated: 1 } },
        }),
      ),
    );
    await expectProviderError(
      decide(adapter),
      'invalid_response',
      /choice distribution is invalid/,
    );
  });

  it('maps a timeout to a timeout error', async () => {
    const adapter = new GeminiAdapter(
      failingFetch(new DOMException('The operation timed out', 'TimeoutError')),
    );
    await expectProviderError(decide(adapter), 'timeout', 'Gemini Decisions request timed out');
  });

  it('maps a caller abort to a timeout error', async () => {
    const { fetch } = scriptedFetch((request) => {
      throw request.signal?.reason ?? new DOMException('aborted', 'AbortError');
    });
    const controller = new AbortController();
    controller.abort();
    const adapter = new GeminiAdapter(fetch);
    await expectProviderError(
      adapter.decide({ input: 'x', questions, apiKey: API_KEY, signal: controller.signal }),
      'timeout',
    );
  });

  it('maps a network failure to an http error without the cause', async () => {
    const adapter = new GeminiAdapter(failingFetch(new TypeError(`fetch failed ${API_KEY}`)));
    await expectProviderError(
      decide(adapter),
      'http',
      'Gemini Decisions request failed (network error)',
    );
  });
});
