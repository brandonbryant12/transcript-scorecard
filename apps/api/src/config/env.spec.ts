import { envSchema } from './env.js';

describe('envSchema', () => {
  it('applies defaults for an empty environment', () => {
    expect(envSchema.parse({})).toEqual({
      PORT: 3001,
      SCORECARD_DB_PATH: './data/scorecard.sqlite',
      GEMINI_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      JEV_API_KEY: undefined,
    });
  });

  it('treats an empty or blank key as not configured', () => {
    const env = envSchema.parse({ GEMINI_API_KEY: '', OPENAI_API_KEY: '   ' });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('trims a key', () => {
    expect(envSchema.parse({ JEV_API_KEY: '  abc  ' }).JEV_API_KEY).toBe('abc');
  });

  it('coerces PORT to a number', () => {
    expect(envSchema.parse({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['abc', '0', '70000', '3.5'])('rejects PORT=%s', (port) => {
    expect(envSchema.safeParse({ PORT: port }).success).toBe(false);
  });

  it('rejects an empty database path', () => {
    expect(envSchema.safeParse({ SCORECARD_DB_PATH: '' }).success).toBe(false);
  });

  it('keeps an in-memory database path', () => {
    expect(envSchema.parse({ SCORECARD_DB_PATH: ':memory:' }).SCORECARD_DB_PATH).toBe(':memory:');
  });
});
