import { Module } from '@nestjs/common';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { JevAdapter } from './adapters/jev.adapter.js';
import { OpenAiAdapter } from './adapters/openai.adapter.js';
import { CredentialsService } from './credentials.service.js';
import { DecisionClient } from './decision-client.service.js';
import { FETCH } from './fetch.token.js';

// Talks to the decision providers (Gemini Decisions, OpenAI Decisions, JEV) behind one
// neutral question-and-answer contract.
@Module({
  providers: [
    { provide: FETCH, useValue: (...args: Parameters<typeof fetch>) => fetch(...args) },
    CredentialsService,
    GeminiAdapter,
    OpenAiAdapter,
    JevAdapter,
    DecisionClient,
  ],
  exports: [DecisionClient, CredentialsService],
})
export class DecisionsModule {}
