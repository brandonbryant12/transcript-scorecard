// Loaded by both Vitest configs before any test module is imported.
//
// ConfigModule reads ../../.env, which can hold real provider keys and a path to the
// developer's database. Process environment variables take precedence over that file,
// so pinning them here keeps every test on a throwaway in-memory database with fake keys.
process.env.SCORECARD_DB_PATH = ':memory:';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.JEV_API_KEY = 'test-jev-key';

// A last line of defence: tests replace the FETCH token with fakes, so nothing should ever
// reach the real global fetch. If something does, fail loudly instead of spending money.
globalThis.fetch = (() => {
  throw new Error('Network access is disabled in tests; inject a fake FETCH instead');
}) as typeof fetch;
