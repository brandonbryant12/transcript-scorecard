import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import type { ScoringProvider } from '@scorecard/domain';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';
import type { Env } from '../src/config/env.js';
import { CredentialsService } from '../src/decisions/credentials.service.js';
import { FETCH } from '../src/decisions/fetch.token.js';
import { REALTIME, type RealtimeModel } from '../src/practice/realtime-model.js';
import { FakeProviders } from './fake-providers.js';

// A real-time model that is never reached in these tests.
export const fakeRealtime: RealtimeModel = {
  model: 'fake-live-model',
  envVar: 'GEMINI_API_KEY',
  isAvailable: () => true,
  connect: () => {
    throw new Error('The real-time model is not available in tests');
  },
};

export interface TestApp {
  readonly app: INestApplication;
  readonly http: Server;
  readonly fakes: FakeProviders;
}

const ENV_VARS: Readonly<Record<ScoringProvider, keyof Env>> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  jev: 'JEV_API_KEY',
};

// Boots the whole application on a fresh in-memory database (test/setup-env.ts pins
// SCORECARD_DB_PATH to ":memory:"), with every provider call answered by FakeProviders.
// Prefix, pipes and WebSocket adapter are set up exactly as main.ts does.
export const createTestApp = async (
  options: {
    // Override which provider keys exist. Omitted: the fake keys from setup-env.ts.
    readonly keys?: Partial<Record<ScoringProvider, string | undefined>>;
    // Bind an ephemeral port on 127.0.0.1, for clients that need a real socket.
    readonly listen?: boolean;
  } = {},
): Promise<TestApp> => {
  const fakes = new FakeProviders();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FETCH)
    .useValue(fakes.fetch)
    .overrideProvider(REALTIME)
    .useValue(fakeRealtime);
  if (options.keys) {
    const keys = options.keys;
    const config = {
      get: (name: keyof Env) =>
        (Object.keys(ENV_VARS) as ScoringProvider[])
          .filter((provider) => ENV_VARS[provider] === name)
          .map((provider) => keys[provider])[0],
    } as unknown as ConfigService<Env, true>;
    builder = builder.overrideProvider(CredentialsService).useValue(new CredentialsService(config));
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useWebSocketAdapter(new WsAdapter(app));
  if (options.listen) await app.listen(0, '127.0.0.1');
  else await app.init();
  return { app, http: app.getHttpServer() as Server, fakes };
};

// Polls `read` until `done` holds, or fails after `timeoutMs`.
export const waitFor = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 10_000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting; last value: ${JSON.stringify(value).slice(0, 500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
