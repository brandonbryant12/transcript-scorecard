import { Inject, Injectable } from '@nestjs/common';
import { PROVIDERS } from '@scorecard/domain';
import { z } from 'zod';
import type {
  Answer,
  DecisionAdapter,
  DecisionRequest,
  DecisionResult,
} from '../decision.types.js';
import { FETCH } from '../fetch.token.js';
import { ProviderError } from '../provider.error.js';
import { checkAnswers, postJson, textOnly, type Fetch } from './adapter-support.js';

const probability = z.number().min(0).max(1);
const name = z.string().nullable();
const wireResponse = z.object({
  model: z.string(),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
  }),
  answers: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('score'),
        name,
        score: z.number(),
        confidence: probability,
        probabilities: z.array(z.object({ value: z.number().int(), probability })),
      }),
      z.object({
        type: z.literal('choice'),
        name,
        choice: z.string(),
        confidence: probability,
        probabilities: z.array(z.object({ value: z.string(), probability })),
      }),
      z.object({ type: z.literal('predicate'), name, probability }),
      z.object({ type: z.literal('refusal'), name }),
    ]),
  ),
});

const info = PROVIDERS.openai;

// OpenAI Decisions. Questions are an ordered array with a `name`; answers come back in
// the same order. A question the model declines is returned as a `refusal`, which fails
// the request rather than becoming a made-up score.
// https://developers.openai.com/api/docs/guides/decisions
@Injectable()
export class OpenAiAdapter implements DecisionAdapter {
  readonly provider = 'openai' as const;

  constructor(@Inject(FETCH) private readonly fetch: Fetch) {}

  async decide({ input, questions, apiKey, signal }: DecisionRequest): Promise<DecisionResult> {
    const names = Object.keys(questions);
    const body = {
      model: info.model,
      input: textOnly('openai', input),
      questions: names.map((key) => {
        const question = questions[key]!;
        if (question.type === 'noul') {
          return { type: 'predicate', name: key, instructions: question.instructions };
        }
        if (question.type === 'choice') {
          return {
            type: 'choice',
            name: key,
            instructions: question.instructions,
            choices: Object.entries(question.options).map(([value, description]) => ({
              value,
              description,
            })),
          };
        }
        return {
          type: 'score',
          name: key,
          instructions: question.instructions,
          levels: question.levels.map((label) => ({ label })),
        };
      }),
    };

    const raw = await postJson('openai', this.fetch, {
      url: info.endpoint,
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal,
    });
    const parsed = wireResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError('openai', 'invalid_response', 'schema mismatch');
    if (parsed.data.answers.length !== names.length) {
      throw new ProviderError('openai', 'invalid_response', 'incomplete answer set');
    }

    const answers: Record<string, Answer> = {};
    parsed.data.answers.forEach((answer, index) => {
      const key = names[index]!;
      const question = questions[key]!;
      if (answer.name !== key)
        throw new ProviderError('openai', 'invalid_response', 'answers out of order');
      if (answer.type === 'refusal') {
        throw new ProviderError('openai', 'rejected', 'the model declined a question');
      }
      if (answer.type === 'predicate') {
        answers[key] = {
          type: 'noul',
          probability: answer.probability,
          confidence: Math.max(answer.probability, 1 - answer.probability),
        };
      } else if (answer.type === 'choice') {
        answers[key] = {
          type: 'choice',
          choice: answer.choice,
          confidence: answer.confidence,
          probabilities: Object.fromEntries(
            answer.probabilities.map((item) => [item.value, item.probability]),
          ),
        };
      } else {
        const levels = question.type === 'score' ? question.levels.length : 0;
        const byLevel = new Map(answer.probabilities.map((item) => [item.value, item.probability]));
        if (byLevel.size !== levels) {
          throw new ProviderError('openai', 'invalid_response', 'score levels do not match');
        }
        answers[key] = {
          type: 'score',
          score: answer.score,
          confidence: answer.confidence,
          // A missing level becomes -1, which `checkAnswers` rejects.
          probabilities: Array.from({ length: levels }, (_, level) => byLevel.get(level) ?? -1),
        };
      }
    });
    return {
      model: parsed.data.model,
      answers: checkAnswers('openai', questions, answers),
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
    };
  }
}
