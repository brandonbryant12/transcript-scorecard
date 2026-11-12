import { z } from 'zod';

// An empty value in .env means "not configured", the same as leaving the line out.
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

// Validated once at startup by ConfigModule. A bad value stops the process with a
// message naming the variable instead of failing later in a request.
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Resolved from apps/api. ":memory:" gives a throwaway database, which the tests use.
  SCORECARD_DB_PATH: z.string().min(1).default('./data/scorecard.sqlite'),
  GEMINI_API_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  JEV_API_KEY: optionalSecret,
});

export type Env = z.infer<typeof envSchema>;
