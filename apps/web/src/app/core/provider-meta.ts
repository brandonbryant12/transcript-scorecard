import type { ScoringProvider } from './models';

export interface ProviderMeta {
  readonly label: string;
  readonly envVar: string;
  /** Whether the provider can read audio clips and video frames as well as text. */
  readonly media: boolean;
}

/** Display facts about each scoring provider, in the order the picker shows them. */
export const PROVIDER_META = {
  gemini: { label: 'Gemini Decisions', envVar: 'GEMINI_API_KEY', media: true },
  openai: { label: 'OpenAI Decisions', envVar: 'OPENAI_API_KEY', media: false },
  jev: { label: 'JEV', envVar: 'JEV_API_KEY', media: false },
} as const satisfies Record<ScoringProvider, ProviderMeta>;

export const PROVIDER_ORDER: readonly ScoringProvider[] = ['gemini', 'openai', 'jev'];

export function providerLabel(provider: ScoringProvider): string {
  return PROVIDER_META[provider].label;
}
