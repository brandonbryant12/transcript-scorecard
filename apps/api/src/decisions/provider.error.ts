import { PROVIDER_LABELS, type ScoringProvider } from '@scorecard/domain';

export type ProviderErrorKind =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'blocked'
  | 'rejected'
  | 'invalid_response'
  | 'http';

// The only provider failure text that may reach a browser. Messages are written for end
// users and never include a provider's response body, which can echo credentials or
// transcript text. Anything that is not a ProviderError is replaced by `publicMessage`.
export class ProviderError extends Error {
  constructor(
    readonly provider: ScoringProvider,
    readonly kind: ProviderErrorKind,
    detail?: string,
  ) {
    const label = PROVIDER_LABELS[provider];
    const suffix = detail ? ` (${detail})` : '';
    const messages: Record<ProviderErrorKind, string> = {
      not_configured: `${detail ?? 'The API key'} is not configured on the API server`,
      auth: `${label} rejected the API credentials`,
      rate_limit: `${label} rate limit reached; try again shortly`,
      timeout: `${label} request timed out`,
      blocked: `${label} blocked the request with its safety filters`,
      rejected: `${label} rejected the request${suffix}`,
      invalid_response: `${label} returned an unexpected response${suffix}`,
      http: `${label} request failed${suffix}`,
    };
    super(messages[kind]);
    this.name = 'ProviderError';
  }

  static publicMessage(cause: unknown, provider: ScoringProvider): string {
    return cause instanceof ProviderError
      ? cause.message
      : `${PROVIDER_LABELS[provider]} scoring failed; check the provider configuration and try again`;
  }
}
