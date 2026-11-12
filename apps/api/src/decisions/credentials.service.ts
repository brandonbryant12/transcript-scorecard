import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PROVIDER_ORDER, PROVIDERS, type ScoringProvider } from '@scorecard/domain';
import type { Env } from '../config/env.js';
import { ProviderError } from './provider.error.js';

// Provider API keys. They are read from the environment on the server and never leave
// it: the browser only ever learns whether a provider is configured.
@Injectable()
export class CredentialsService {
  private readonly keys: Readonly<Record<ScoringProvider, string | undefined>>;

  constructor(config: ConfigService<Env, true>) {
    this.keys = {
      gemini: config.get('GEMINI_API_KEY', { infer: true }),
      openai: config.get('OPENAI_API_KEY', { infer: true }),
      jev: config.get('JEV_API_KEY', { infer: true }),
    };
  }

  isConfigured(provider: ScoringProvider): boolean {
    return Boolean(this.keys[provider]);
  }

  // The provider used when a request does not name one: the first configured provider
  // in preference order, so a fresh checkout works with whichever key is present.
  get defaultProvider(): ScoringProvider {
    return PROVIDER_ORDER.find((provider) => this.isConfigured(provider)) ?? PROVIDER_ORDER[0]!;
  }

  keyFor(provider: ScoringProvider): string {
    const key = this.keys[provider];
    if (!key) throw new ProviderError(provider, 'not_configured', PROVIDERS[provider].envVar);
    return key;
  }
}
