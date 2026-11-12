import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { checkAnswers, levelArray, postJson, type Fetch } from './adapter-support.js';

const probability = z.number().min(0).max(1);
const wireResponse = z.object({
  answers: z.record(
    z.string(),
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('noul'), noul: probability, confidence: probability.optional() }),
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
    total_input_tokens: z.number().nonnegative(),
    total_output_tokens: z.number().nonnegative().optional(),
  }),
});

// The API reports a safety block as HTTP 400 with one of these codes.
const SAFETY_CODES = new Set([
  'safety',
  'prohibited_content',
  'blocklist',
  'image_safety',
  'content_blocked',
]);

const info = PROVIDERS.gemini;

// Gemini Decisions API (v1beta). Questions and answers are maps keyed by a name we
// choose; the model never sees the keys, so every instruction is a complete question.
// https://aistudio.google.com/docs/decisions-api
@Injectable()
export class GeminiAdapter implements DecisionAdapter {
  readonly provider = 'gemini' as const;
  private readonly logger = new Logger(GeminiAdapter.name);

  constructor(@Inject(FETCH) private readonly fetch: Fetch) {}

  async decide({ input, questions, apiKey, signal }: DecisionRequest): Promise<DecisionResult> {
    const body = {
      model: info.model,
      // Text goes as a plain string. With media, blocks follow the Interactions content
      // schema. Images are sent at low resolution: measured at 264 tokens each, enough to
      // read a face and posture, where leaving the resolution unset costs 1,100. Audio is
      // billed at about 30 tokens per second whatever its encoding.
      input:
        typeof input === 'string'
          ? input
          : input.map((block) =>
              block.type === 'text'
                ? { type: 'text', text: block.text }
                : block.type === 'audio'
                  ? { type: 'audio', data: block.data, mime_type: block.mimeType }
                  : {
                      type: 'image',
                      data: block.data,
                      mime_type: block.mimeType,
                      resolution: 'low',
                    },
            ),
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

    const raw = await postJson(
      'gemini',
      this.fetch,
      { url: info.endpoint, headers: { 'x-goog-api-key': apiKey }, body, signal },
      (status, errorBody) => this.explain(status, errorBody),
    );
    const parsed = wireResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError('gemini', 'invalid_response', 'schema mismatch');

    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = parsed.data.answers[key];
      if (!answer) continue;
      if (answer.type === 'noul') {
        answers[key] = {
          type: 'noul',
          probability: answer.noul,
          confidence: answer.confidence ?? Math.max(answer.noul, 1 - answer.noul),
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
      // The response does not name the model, so report the one that was requested.
      model: info.model,
      answers: checkAnswers('gemini', questions, answers),
      inputTokens: parsed.data.usage.total_input_tokens,
      outputTokens: parsed.data.usage.total_output_tokens ?? 0,
    };
  }

  private explain(status: number, errorBody: unknown): ProviderError | undefined {
    if (status !== 400) return undefined;
    const error = (errorBody as { error?: { code?: unknown; message?: unknown } } | undefined)
      ?.error;
    const code = typeof error?.code === 'string' ? error.code : '';
    const message = typeof error?.message === 'string' ? error.message : '';
    if (SAFETY_CODES.has(code)) return new ProviderError('gemini', 'blocked');
    // Google reports a bad key as 400 INVALID_ARGUMENT rather than 401.
    if (/api key/i.test(message)) return new ProviderError('gemini', 'auth');
    // Any other 400 names the limit or key rule the request broke. The detail stays in
    // the server log: it can quote parts of the request.
    this.logger.warn(`Request rejected: ${message.slice(0, 300)}`);
    return new ProviderError('gemini', 'rejected', 'HTTP 400');
  }
}
