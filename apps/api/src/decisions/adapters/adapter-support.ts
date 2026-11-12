import type { ScoringProvider } from '@scorecard/domain';
import type { Answer, DecisionInput, Questions } from '../decision.types.js';
import { ProviderError } from '../provider.error.js';

export const REQUEST_TIMEOUT_MS = 30_000;

export type Fetch = typeof fetch;

// POST JSON with a hard timeout and one mapping from failures to ProviderError. Returns
// the parsed body of a 2xx response. `onError` lets an adapter recognise failures its
// provider reports in the body of a non-2xx response.
export const postJson = async (
  provider: ScoringProvider,
  fetchImplementation: Fetch,
  request: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
    readonly signal?: AbortSignal | undefined;
  },
  onError?: (status: number, body: unknown) => ProviderError | undefined,
): Promise<unknown> => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImplementation(request.url, {
      method: 'POST',
      headers: { ...request.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    const name = cause instanceof Error ? cause.name : '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    throw new ProviderError(
      provider,
      timedOut ? 'timeout' : 'http',
      timedOut ? undefined : 'network error',
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const specific = onError?.(response.status, body);
    if (specific) throw specific;
    if (response.status === 401 || response.status === 403)
      throw new ProviderError(provider, 'auth');
    if (response.status === 429) throw new ProviderError(provider, 'rate_limit');
    throw new ProviderError(provider, 'http', `HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError(provider, 'invalid_response', 'body was not JSON');
  }
};

// For providers that take text only. Media reaching one of them is a programming error
// in the caller (the scoring engine checks the provider's capability first), so it
// fails loudly instead of silently dropping the clip.
export const textOnly = (provider: ScoringProvider, input: DecisionInput): string => {
  if (typeof input === 'string') return input;
  if (input.some((block) => block.type !== 'text')) {
    throw new ProviderError(provider, 'rejected', 'media input is not supported');
  }
  return input.map((block) => (block.type === 'text' ? block.text : '')).join('');
};

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

// Every adapter funnels its normalised answers through here, so a provider can never
// hand the scoring engine a missing, mistyped or out-of-range answer. A bad answer fails
// the request; it is never papered over with a default.
export const checkAnswers = (
  provider: ScoringProvider,
  questions: Questions,
  answers: Readonly<Record<string, Answer | undefined>>,
): Readonly<Record<string, Answer>> => {
  const fail = (detail: string): never => {
    throw new ProviderError(provider, 'invalid_response', detail);
  };
  const checked: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const answer = answers[key];
    if (!answer) return fail('an answer is missing');
    if (answer.type !== question.type) return fail('an answer has the wrong type');
    if (!isProbability(answer.confidence)) return fail('a confidence is out of range');
    if (answer.type === 'noul') {
      if (!isProbability(answer.probability)) return fail('a probability is out of range');
    } else if (answer.type === 'choice' && question.type === 'choice') {
      if (!Object.hasOwn(question.options, answer.choice))
        return fail('a choice is not one of the options');
      for (const [option, probability] of Object.entries(answer.probabilities)) {
        if (!Object.hasOwn(question.options, option) || !isProbability(probability)) {
          return fail('a choice distribution is invalid');
        }
      }
    } else if (answer.type === 'score' && question.type === 'score') {
      const top = question.levels.length - 1;
      if (typeof answer.score !== 'number' || !(answer.score >= 0 && answer.score <= top)) {
        return fail('a score is outside its rubric');
      }
      if (
        answer.probabilities.length !== question.levels.length ||
        !answer.probabilities.every(isProbability)
      ) {
        return fail('a score distribution is invalid');
      }
    }
    checked[key] = answer;
  }
  return checked;
};

// Map-shaped rubric probabilities ({ "0": 0.1, "1": 0.9 }) to an array in level order.
export const levelArray = (
  probabilities: Readonly<Record<string, number>>,
  levels: number,
): ReadonlyArray<number> =>
  Array.from({ length: levels }, (_, level) => probabilities[String(level)] ?? 0);
