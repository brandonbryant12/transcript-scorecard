import { ProviderError, type ProviderErrorKind } from './provider.error.js';

describe('ProviderError', () => {
  it.each<[ProviderErrorKind, string | undefined, string]>([
    ['auth', undefined, 'Gemini Decisions rejected the API credentials'],
    ['rate_limit', undefined, 'Gemini Decisions rate limit reached; try again shortly'],
    ['timeout', undefined, 'Gemini Decisions request timed out'],
    ['blocked', undefined, 'Gemini Decisions blocked the request with its safety filters'],
    ['rejected', 'HTTP 400', 'Gemini Decisions rejected the request (HTTP 400)'],
    ['rejected', undefined, 'Gemini Decisions rejected the request'],
    [
      'invalid_response',
      'schema mismatch',
      'Gemini Decisions returned an unexpected response (schema mismatch)',
    ],
    ['http', 'HTTP 503', 'Gemini Decisions request failed (HTTP 503)'],
    ['not_configured', 'GEMINI_API_KEY', 'GEMINI_API_KEY is not configured on the API server'],
    ['not_configured', undefined, 'The API key is not configured on the API server'],
  ])('writes a %s error (detail %j) for end users', (kind, detail, message) => {
    const error = new ProviderError('gemini', kind, detail);
    expect(error.message).toBe(message);
    expect(error).toMatchObject({ name: 'ProviderError', provider: 'gemini', kind });
    expect(error).toBeInstanceOf(Error);
  });

  it('labels the provider in its message', () => {
    expect(new ProviderError('jev', 'auth').message).toBe('JEV rejected the API credentials');
    expect(new ProviderError('openai', 'timeout').message).toBe(
      'OpenAI Decisions request timed out',
    );
  });

  describe('publicMessage', () => {
    it('passes a ProviderError message through', () => {
      expect(ProviderError.publicMessage(new ProviderError('openai', 'rate_limit'), 'openai')).toBe(
        'OpenAI Decisions rate limit reached; try again shortly',
      );
    });

    it('replaces any other failure with a generic message', () => {
      const message = ProviderError.publicMessage(
        new Error('SQLITE_ERROR near "secret transcript"'),
        'jev',
      );
      expect(message).toBe('JEV scoring failed; check the provider configuration and try again');
      expect(message).not.toContain('secret');
    });

    it('handles a thrown non-error value', () => {
      expect(ProviderError.publicMessage('boom', 'gemini')).toBe(
        'Gemini Decisions scoring failed; check the provider configuration and try again',
      );
    });
  });
});
