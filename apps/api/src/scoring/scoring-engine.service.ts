import { Injectable } from '@nestjs/common';
import {
  composeEvaluation,
  estimateProviderCostUsd,
  PROVIDERS,
  type EvaluationBody,
  type ScorecardDefinition,
  type ScoringProvider,
  type ScoringState,
  type Stage,
  type TranscriptTurn,
  type UsageSummary,
} from '@scorecard/domain';
import { DecisionClient } from '../decisions/decision-client.service.js';
import type { Answer, DecisionInput, Question } from '../decisions/decision.types.js';
import {
  applyAnswers,
  planMediaRequests,
  planQuestions,
  renderTranscript,
  type CallContext,
  type PlannedQuestion,
  type TurnMedia,
} from './question-plan.js';

// Requests larger than this are split. Every provider accepts more, but smaller requests
// keep per-request latency predictable and stay well inside each provider's limits.
export const MAX_QUESTIONS_PER_REQUEST = 300;

// What one provider API call cost: a row for the request ledger.
export interface RequestRecord {
  readonly startedAt: string;
  readonly latencyMs: number;
  readonly questionCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly model: string | null;
  readonly ok: boolean;
}

export interface ScoreInput {
  readonly provider: ScoringProvider;
  readonly call: CallContext;
  readonly definition: ScorecardDefinition;
  // Every turn seen so far, in order.
  readonly turns: ReadonlyArray<TranscriptTurn>;
  // Readings from earlier passes over the same call. Turns already read are skipped.
  readonly state: ScoringState;
  readonly stage: Stage;
  // Audio clips and video frames by turn id, for calls that have them. Ignored when the
  // provider cannot take media; the skills that need it are then reported as unassessed.
  readonly media?: Readonly<Record<string, TurnMedia>> | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onStart?: ((startedAt: string) => void | Promise<void>) | undefined;
  // Called once per provider request, including failed ones.
  readonly onRequest?: ((record: RequestRecord) => void | Promise<void>) | undefined;
}

export interface ScoreOutput {
  readonly state: ScoringState;
  readonly body: EvaluationBody;
  readonly model: string;
  readonly usage: UsageSummary;
}

interface PlannedRequest {
  readonly input: DecisionInput;
  readonly questions: ReadonlyArray<PlannedQuestion>;
}

const inChunks = <T>(items: ReadonlyArray<T>, size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
};

// One scoring pass: plan the questions the call still needs, ask them, fold the answers
// into the readings and compose the evaluation. The same pass serves a live tick (a few
// new turns, provisional) and a finished transcript (every turn, final).
@Injectable()
export class ScoringEngine {
  constructor(private readonly decisions: DecisionClient) {}

  async score(input: ScoreInput): Promise<ScoreOutput> {
    if (input.turns.length === 0) throw new Error('Cannot score an empty transcript');
    const requests = this.plan(input);
    const planned = requests.flatMap((request) => request.questions);

    const startedAt = new Date().toISOString();
    await input.onStart?.(startedAt);
    const started = performance.now();
    const results = await Promise.allSettled(requests.map((request) => this.ask(input, request)));
    const latencyMs = Math.round(performance.now() - started);

    const answers: Record<string, Answer> = {};
    let model = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for (const result of results) {
      // A partial pass would leave some turns unread while looking complete, so any
      // failed request fails the pass and the readings stay as they were.
      if (result.status === 'rejected') throw result.reason;
      Object.assign(answers, result.value.answers);
      model = result.value.model;
      inputTokens += result.value.inputTokens;
      outputTokens += result.value.outputTokens;
    }

    const state = applyAnswers(input.state, planned, answers);
    return {
      state,
      body: composeEvaluation(input.definition, state, input.turns, input.stage),
      model,
      usage: {
        requests: results.length,
        questions: planned.length,
        inputTokens,
        outputTokens,
        latencyMs,
        estimatedCostUsd: estimateProviderCostUsd(input.provider, inputTokens, outputTokens),
      },
    };
  }

  // Transcript questions share one input and are split only by size. Each media request
  // carries its own clip.
  private plan(input: ScoreInput): ReadonlyArray<PlannedRequest> {
    const transcript = renderTranscript(input.call, input.turns, input.stage);
    const textQuestions = planQuestions(input.definition, input.turns, input.state, input.stage);
    const mediaRequests =
      input.media && PROVIDERS[input.provider].media
        ? planMediaRequests(input.definition, input.turns, input.state, input.media)
        : [];
    return [
      ...inChunks(textQuestions, MAX_QUESTIONS_PER_REQUEST).map((questions) => ({
        input: transcript,
        questions,
      })),
      ...mediaRequests.map((request) => ({ input: request.blocks, questions: request.questions })),
    ];
  }

  private async ask(input: ScoreInput, request: PlannedRequest) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const record = (fields: Pick<RequestRecord, 'inputTokens' | 'outputTokens' | 'model' | 'ok'>) =>
      input.onRequest?.({
        startedAt,
        latencyMs: Math.round(performance.now() - started),
        questionCount: request.questions.length,
        estimatedCostUsd: estimateProviderCostUsd(
          input.provider,
          fields.inputTokens,
          fields.outputTokens,
        ),
        ...fields,
      });
    try {
      const result = await this.decisions.decide(
        input.provider,
        request.input,
        Object.fromEntries(
          request.questions.map((item): [string, Question] => [item.key, item.question]),
        ),
        input.signal,
      );
      await record({
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
        ok: true,
      });
      return result;
    } catch (cause) {
      await record({ inputTokens: 0, outputTokens: 0, model: null, ok: false });
      throw cause;
    }
  }
}
