import { z } from 'zod';

// Every provider here exposes a "decisions" style endpoint: typed questions in,
// calibrated probabilities out, no generated text.
export const ScoringProviderSchema = z.enum(['gemini', 'openai', 'jev']);
export type ScoringProvider = z.infer<typeof ScoringProviderSchema>;

export interface ProviderPricing {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly currency: 'USD';
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

export interface ProviderInfo {
  readonly id: ScoringProvider;
  readonly label: string;
  readonly model: string;
  readonly envVar: string;
  readonly endpoint: string;
  readonly docsUrl: string;
  // Whether the provider accepts audio and image input alongside text.
  readonly media: boolean;
  readonly pricing: ProviderPricing;
}

export const PROVIDERS: Readonly<Record<ScoringProvider, ProviderInfo>> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini Decisions',
    model: 'gemini-decision-1',
    envVar: 'GEMINI_API_KEY',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/decisions',
    docsUrl: 'https://aistudio.google.com/docs/decisions-api',
    media: true,
    pricing: {
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0,
      currency: 'USD',
      sourceUrl: 'https://aistudio.google.com/docs/pricing#gemini-decision',
      checkedAt: '2026-11-11',
    },
  },
  openai: {
    id: 'openai',
    label: 'OpenAI Decisions',
    model: 'gpt-6-luna',
    envVar: 'OPENAI_API_KEY',
    endpoint: 'https://api.openai.com/v1/decisions',
    docsUrl: 'https://developers.openai.com/api/docs/guides/decisions',
    media: false,
    pricing: {
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0,
      currency: 'USD',
      sourceUrl: 'https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability',
      checkedAt: '2026-10-06',
    },
  },
  jev: {
    id: 'jev',
    label: 'JEV',
    model: 'jev-latest',
    envVar: 'JEV_API_KEY',
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    docsUrl: 'https://typesafe.ai/blog/introducing-system-one-models-and-jev',
    media: false,
    pricing: {
      inputUsdPerMillion: 0.042,
      outputUsdPerMillion: 0,
      currency: 'USD',
      sourceUrl: 'https://typesafe.ai/blog/introducing-system-one-models-and-jev',
      checkedAt: '2026-09-16',
    },
  },
};

// Preference order when the caller does not name a provider: the first configured wins.
export const PROVIDER_ORDER: ReadonlyArray<ScoringProvider> = ['gemini', 'openai', 'jev'];

export const PROVIDER_LABELS: Readonly<Record<ScoringProvider, string>> = {
  gemini: PROVIDERS.gemini.label,
  openai: PROVIDERS.openai.label,
  jev: PROVIDERS.jev.label,
};

export const providerPricing = (provider: ScoringProvider): ProviderPricing =>
  PROVIDERS[provider].pricing;

export const estimateProviderCostUsd = (
  provider: ScoringProvider,
  inputTokens: number,
  outputTokens: number,
): number => {
  const pricing = providerPricing(provider);
  return (
    (inputTokens * pricing.inputUsdPerMillion + outputTokens * pricing.outputUsdPerMillion) /
    1_000_000
  );
};
