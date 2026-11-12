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
import { checkAnswers, levelArray, postJson, textOnly, type Fetch } from './adapter-support.js';

const probability = z.number().min(0).max(1);
const wireResponse = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('noul'), noul: probability }),
      z.object({
        type: z.literal('choice'),
        choice: z.string(),
        confidence: probability,
        probabilities: z.record(z.string(), probability),
      }),
      z.object({
        type: z.literal('score'),
        score: z.number(),
        confidence: probability,
        probabilities: z.record(z.string(), probability),
      }),
    ]),
  ),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
  }),
});

const info = PROVIDERS.jev;

// TypeSafe JEV (System One). The same map-in, map-out shape as Gemini Decisions; the
// shared input is called `state` and yes/no answers carry no separate confidence.
@Injectable()
export class JevAdapter implements DecisionAdapter {
  readonly provider = 'jev' as const;

  constructor(@Inject(FETCH) private readonly fetch: Fetch) {}

  async decide({ input, questions, apiKey, signal }: DecisionRequest): Promise<DecisionResult> {
    const body = {
      model: info.model,
      state: textOnly('jev', input),
      questions: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [
          key,
          question.type === 'noul'
            ? { type: 'noul', instructions: question.instructions }
            : question.type === 'choice'
              ? { type: 'choice', instructions: question.instructions, criteria: question.options }
              : { type: 'score', instructions: question.instructions, criteria: question.levels },
        ]),
      ),
    };

    const raw = await postJson('jev', this.fetch, {
      url: info.endpoint,
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal,
    });
    const parsed = wireResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError('jev', 'invalid_response', 'schema mismatch');

    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = parsed.data.answers[key];
      if (!answer) continue;
      if (answer.type === 'noul') {
        answers[key] = {
          type: 'noul',
          probability: answer.noul,
          confidence: Math.max(answer.noul, 1 - answer.noul),
        };
      } else if (answer.type === 'choice') {
        answers[key] = answer;
      } else {
        answers[key] = {
          type: 'score',
          score: answer.score,
          confidence: answer.confidence,
          probabilities: levelArray(
            answer.probabilities,
            question.type === 'score' ? question.levels.length : 0,
          ),
        };
      }
    }
    return {
      model: parsed.data.model,
      answers: checkAnswers('jev', questions, answers),
      // The output count reflects the size of the answer payload; output is not billed.
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
    };
  }
}
