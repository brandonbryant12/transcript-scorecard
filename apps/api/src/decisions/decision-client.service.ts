import { Injectable } from '@nestjs/common';
import type { ScoringProvider } from '@scorecard/domain';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { JevAdapter } from './adapters/jev.adapter.js';
import { OpenAiAdapter } from './adapters/openai.adapter.js';
import { CredentialsService } from './credentials.service.js';
import type {
  DecisionAdapter,
  DecisionInput,
  DecisionResult,
  Questions,
} from './decision.types.js';

// The one door to every decision provider. Callers name a provider and ask questions;
// which wire format and which API key that means stays in here.
@Injectable()
export class DecisionClient {
  private readonly adapters: Readonly<Record<ScoringProvider, DecisionAdapter>>;

  constructor(
    private readonly credentials: CredentialsService,
    gemini: GeminiAdapter,
    openai: OpenAiAdapter,
    jev: JevAdapter,
  ) {
    this.adapters = { gemini, openai, jev };
  }

  decide(
    provider: ScoringProvider,
    input: DecisionInput,
    questions: Questions,
    signal?: AbortSignal,
  ): Promise<DecisionResult> {
    return this.adapters[provider].decide({
      input,
      questions,
      apiKey: this.credentials.keyFor(provider),
      signal,
    });
  }
}
