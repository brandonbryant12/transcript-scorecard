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
import { OpenAiAdapter } from './openai.adapter.js';

const questions: Questions = {
  yes_no: { type: 'noul', instructions: 'Did the employee greet the customer?' },
  pick: {
    type: 'choice',
    instructions: 'Which emotion?',
    options: { calm: 'Calm and steady', angry: 'Visibly angry' },
  },
  rate: { type: 'score', instructions: 'Rate empathy', levels: ['Low', 'Mid', 'High'] },
};

const predicate = { type: 'predicate', name: 'yes_no', probability: 0.3 };
const choice = {
  type: 'choice',
  name: 'pick',
  choice: 'angry',
  confidence: 0.8,
  probabilities: [
    { value: 'calm', probability: 0.2 },
    { value: 'angry', probability: 0.8 },
  ],
};
const score = {
  type: 'score',
  name: 'rate',
  score: 1.1,
  confidence: 0.6,
  // Deliberately not in level order.
  probabilities: [
    { value: 2, label: 'High', probability: 0.25 },
    { value: 0, label: 'Low', probability: 0.15 },
    { value: 1, label: 'Mid', probability: 0.6 },
  ],
};

const body = (answers: ReadonlyArray<unknown> = [predicate, choice, score]) => ({
  model: 'gpt-6-luna-2026-10-01',
  usage: { input_tokens: 900, output_tokens: 40 },
  answers,
});

const adapterWith = (respond: (request: CapturedRequest) => Response | Promise<Response>) => {
  const fake = scriptedFetch(respond);
  return { adapter: new OpenAiAdapter(fake.fetch), requests: fake.requests, fetch: fake.fetch };
};

const decide = (adapter: OpenAiAdapter, input: DecisionInput = 'transcript text') =>
  adapter.decide({ input, questions, apiKey: API_KEY });

describe('OpenAiAdapter request', () => {
  it('posts to the OpenAI Decisions endpoint with a bearer token', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(body()));
    await decide(adapter);
    expect(requests[0]!.url).toBe(PROVIDERS.openai.endpoint);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(requests[0]!.rawBody).not.toContain(API_KEY);
  });

  it('sends questions as an ordered array with names, choices and score levels', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(body()));
    await decide(adapter);
    expect(requests[0]!.body).toEqual({
      model: PROVIDERS.openai.model,
      input: 'transcript text',
      questions: [
        { type: 'predicate', name: 'yes_no', instructions: 'Did the employee greet the customer?' },
        {
          type: 'choice',
          name: 'pick',
          instructions: 'Which emotion?',
          choices: [
            { value: 'calm', description: 'Calm and steady' },
            { value: 'angry', description: 'Visibly angry' },
          ],
        },
        {
          type: 'score',
          name: 'rate',
          instructions: 'Rate empathy',
          levels: [{ label: 'Low' }, { label: 'Mid' }, { label: 'High' }],
        },
      ],
    });
  });

  it('joins text-only blocks into one string', async () => {
    const { adapter, requests } = adapterWith(() => jsonResponse(body()));
    await decide(adapter, [
      { type: 'text', text: 'first ' },
      { type: 'text', text: 'second' },
    ]);
    expect(requests[0]!.body.input).toBe('first second');
  });

  it('refuses media input before calling the provider', async () => {
    const { adapter, fetch } = adapterWith(() => jsonResponse(body()));
    await expectProviderError(
      decide(adapter, [
        { type: 'text', text: 'context' },
        { type: 'audio', data: 'UklGRg==', mimeType: 'audio/wav' },
      ]),
      'rejected',
      /media input is not supported/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('OpenAiAdapter answers', () => {
  it('normalises predicates, choices and scores and maps usage', async () => {
    const { adapter } = adapterWith(() => jsonResponse(body()));
    expect(await decide(adapter)).toEqual({
      model: 'gpt-6-luna-2026-10-01',
      answers: {
        yes_no: { type: 'noul', probability: 0.3, confidence: 0.7 },
        pick: {
          type: 'choice',
          choice: 'angry',
          confidence: 0.8,
          probabilities: { calm: 0.2, angry: 0.8 },
        },
        rate: { type: 'score', score: 1.1, confidence: 0.6, probabilities: [0.15, 0.6, 0.25] },
      },
      inputTokens: 900,
      outputTokens: 40,
    });
  });
});

describe('OpenAiAdapter failures', () => {
  const secretBody = { error: { message: `${API_KEY} ${BODY_MARKER}` } };

  it.each([401, 403])('maps HTTP %i to an auth error', async (status) => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, status));
    await expectProviderError(decide(adapter), 'auth');
  });

  it('maps HTTP 429 to a rate limit error', async () => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, 429));
    await expectProviderError(
      decide(adapter),
      'rate_limit',
      'OpenAI Decisions rate limit reached; try again shortly',
    );
  });

  it('maps HTTP 500 to an http error', async () => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, 500));
    await expectProviderError(decide(adapter), 'http', /HTTP 500/);
  });

  it('maps a 400 to an http error without the body', async () => {
    const { adapter } = adapterWith(() => jsonResponse(secretBody, 400));
    await expectProviderError(decide(adapter), 'http', /HTTP 400/);
  });

  it('rejects a success response that is not JSON', async () => {
    const { adapter } = adapterWith(() => textResponse(BODY_MARKER));
    await expectProviderError(decide(adapter), 'invalid_response', /body was not JSON/);
  });

  it('rejects a response that does not match the wire schema', async () => {
    const { adapter } = adapterWith(() => jsonResponse({ answers: {}, note: BODY_MARKER }));
    await expectProviderError(decide(adapter), 'invalid_response', /schema mismatch/);
  });

  it('fails the request when the model refuses a question', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(body([predicate, { type: 'refusal', name: 'pick' }, score])),
    );
    await expectProviderError(decide(adapter), 'rejected', /the model declined a question/);
  });

  it('rejects answers that come back out of order', async () => {
    const { adapter } = adapterWith(() => jsonResponse(body([choice, predicate, score])));
    await expectProviderError(decide(adapter), 'invalid_response', /answers out of order/);
  });

  it('rejects an answer set of the wrong length', async () => {
    const { adapter } = adapterWith(() => jsonResponse(body([predicate, choice])));
    await expectProviderError(decide(adapter), 'invalid_response', /incomplete answer set/);
  });

  it('rejects an answer of the wrong type', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        body([predicate, choice, { type: 'predicate', name: 'rate', probability: 0.5 }]),
      ),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /wrong type/);
  });

  it('rejects a score distribution with the wrong number of levels', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        body([predicate, choice, { ...score, probabilities: score.probabilities.slice(1) }]),
      ),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /score levels do not match/);
  });

  it('rejects a score distribution that skips a level', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(
        body([
          predicate,
          choice,
          {
            ...score,
            probabilities: [
              { value: 0, label: 'Low', probability: 0.2 },
              { value: 1, label: 'Mid', probability: 0.6 },
              { value: 5, label: '?', probability: 0.2 },
            ],
          },
        ]),
      ),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /score distribution is invalid/);
  });

  it('rejects a score outside the rubric', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(body([predicate, choice, { ...score, score: 2.5 }])),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /outside its rubric/);
  });

  it('rejects a choice that is not one of the options', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(body([predicate, { ...choice, choice: 'elated' }, score])),
    );
    await expectProviderError(decide(adapter), 'invalid_response', /not one of the options/);
  });

  it('maps a timeout to a timeout error', async () => {
    const adapter = new OpenAiAdapter(failingFetch(new DOMException('timed out', 'TimeoutError')));
    await expectProviderError(decide(adapter), 'timeout');
  });

  it('maps a network failure to an http error', async () => {
    const adapter = new OpenAiAdapter(failingFetch(new TypeError('fetch failed')));
    await expectProviderError(decide(adapter), 'http', /network error/);
  });
});
