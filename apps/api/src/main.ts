import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { PROVIDER_ORDER, PROVIDERS } from '@scorecard/domain';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { CredentialsService } from './decisions/credentials.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // Request bodies and parameters are validated against the Zod schemas their handlers
  // declare; the schemas live in @scorecard/domain and are shared with the web app.
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  // Practice calls use plain WebSockets, so a browser needs no client library.
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true });
  await app.listen(port, '127.0.0.1');

  const logger = new Logger('Bootstrap');
  const credentials = app.get(CredentialsService);
  const configured = PROVIDER_ORDER.filter((provider) => credentials.isConfigured(provider));
  logger.log(`Scorecard API listening on http://127.0.0.1:${port}/api`);
  logger.log(
    configured.length > 0
      ? `Providers configured: ${configured.map((provider) => PROVIDERS[provider].label).join(', ')} (default: ${PROVIDERS[credentials.defaultProvider].label})`
      : `No provider key is configured. Set ${PROVIDER_ORDER.map((provider) => PROVIDERS[provider].envVar).join(', ')} in .env to score calls.`,
  );
}
await bootstrap();
