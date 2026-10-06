import { PROVIDER_LABELS, type ScoringProvider } from "@scorecard/domain"

export interface ProviderCredentials {
  readonly openai?: string | undefined
  readonly jev?: string | undefined
}

export const requireProviderKey = (credentials: ProviderCredentials, provider: ScoringProvider): string => {
  const key = credentials[provider]
  if (!key) throw new Error(`${provider === "openai" ? "OPENAI_API_KEY" : "JEV_API_KEY"} is not configured on the API server`)
  return key
}

export const publicProviderError = (cause: unknown, provider: ScoringProvider): string => {
  const message = cause instanceof Error ? cause.message : "Scoring failed"
  if (/401|403|credentials|unauthorized/i.test(message)) return `${PROVIDER_LABELS[provider]} rejected the API credentials`
  if (/429|rate limit/i.test(message)) return `${PROVIDER_LABELS[provider]} rate limit reached; try again shortly`
  if (/abort|timeout/i.test(message)) return `${PROVIDER_LABELS[provider]} request timed out`
  // Schema decoder errors may contain the raw provider response. Keep them server-side.
  return `${PROVIDER_LABELS[provider]} scoring failed; check the provider configuration and try again`
}
