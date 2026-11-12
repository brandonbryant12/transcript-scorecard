import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { CredentialsService } from './credentials.service.js';
import { ProviderError } from './provider.error.js';

const credentials = (keys: Partial<Record<keyof Env, string>>) =>
  new CredentialsService({
    get: (name: keyof Env) => keys[name],
  } as unknown as ConfigService<Env, true>);

describe('CredentialsService', () => {
  it('reports which providers have a key', () => {
    const service = credentials({ OPENAI_API_KEY: 'o' });
    expect(service.isConfigured('openai')).toBe(true);
    expect(service.isConfigured('gemini')).toBe(false);
    expect(service.isConfigured('jev')).toBe(false);
  });

  it('defaults to the first configured provider in preference order', () => {
    expect(
      credentials({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', JEV_API_KEY: 'j' }).defaultProvider,
    ).toBe('gemini');
    expect(credentials({ OPENAI_API_KEY: 'o', JEV_API_KEY: 'j' }).defaultProvider).toBe('openai');
    expect(credentials({ JEV_API_KEY: 'j' }).defaultProvider).toBe('jev');
  });

  it('falls back to the first provider when none is configured', () => {
    expect(credentials({}).defaultProvider).toBe('gemini');
  });

  it('returns the key for a configured provider', () => {
    expect(credentials({ JEV_API_KEY: 'jev-key' }).keyFor('jev')).toBe('jev-key');
  });

  it('throws a not_configured ProviderError naming the variable for a missing key', () => {
    const attempt = () => credentials({ GEMINI_API_KEY: 'g' }).keyFor('openai');
    expect(attempt).toThrow(ProviderError);
    expect(attempt).toThrow('OPENAI_API_KEY is not configured on the API server');
    try {
      attempt();
    } catch (error) {
      expect((error as ProviderError).kind).toBe('not_configured');
    }
  });
});
