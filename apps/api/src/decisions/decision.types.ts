import type { ScoringProvider } from '@scorecard/domain';

// The neutral contract every adapter translates to and from. It mirrors what the
// decision APIs have in common: yes/no, pick-one and ordered-rubric questions asked
// independently against one shared input, answered with calibrated probabilities.
export type Question =
  | { readonly type: 'noul'; readonly instructions: string }
  | {
      readonly type: 'choice';
      readonly instructions: string;
      readonly options: Readonly<Record<string, string>>;
    }
  | {
      readonly type: 'score';
      readonly instructions: string;
      readonly levels: ReadonlyArray<string>;
    };

export type Questions = Readonly<Record<string, Question>>;

export type Answer =
  | { readonly type: 'noul'; readonly probability: number; readonly confidence: number }
  | {
      readonly type: 'choice';
      readonly choice: string;
      readonly confidence: number;
      readonly probabilities: Readonly<Record<string, number>>;
    }
  | {
      readonly type: 'score';
      readonly score: number;
      readonly confidence: number;
      // One probability per rubric level, in level order.
      readonly probabilities: ReadonlyArray<number>;
    };

// The shared input. Plain text for a transcript; blocks when a turn's audio clip or
// video frames ride along. Media is base64, as the provider APIs expect it inline.
export type InputBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'audio'; readonly data: string; readonly mimeType: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

export type DecisionInput = string | ReadonlyArray<InputBlock>;

export interface DecisionResult {
  readonly model: string;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface DecisionRequest {
  readonly input: DecisionInput;
  readonly questions: Questions;
  readonly apiKey: string;
  readonly signal?: AbortSignal | undefined;
}

// One provider's wire format. Implementations translate the neutral request into the
// provider's JSON, call it, and hand back answers that have passed `checkAnswers`.
export interface DecisionAdapter {
  readonly provider: ScoringProvider;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}
