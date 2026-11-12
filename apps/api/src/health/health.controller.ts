import { Controller, Get, Inject } from '@nestjs/common';
import { PROVIDER_ORDER, type HealthStatus, type ScoringProvider } from '@scorecard/domain';
import { CredentialsService } from '../decisions/credentials.service.js';
import { REALTIME, type RealtimeModel } from '../practice/realtime-model.js';

// Tells the web app what this server can do. It reports which providers have a key
// configured; the keys themselves never leave the server.
@Controller('health')
export class HealthController {
  constructor(
    private readonly credentials: CredentialsService,
    @Inject(REALTIME) private readonly realtime: RealtimeModel,
  ) {}

  @Get()
  status(): HealthStatus {
    return {
      ok: true,
      defaultProvider: this.credentials.defaultProvider,
      providers: Object.fromEntries(
        PROVIDER_ORDER.map((provider) => [provider, this.credentials.isConfigured(provider)]),
      ) as Record<ScoringProvider, boolean>,
      realtime: {
        available: this.realtime.isAvailable(),
        model: this.realtime.model,
        envVar: this.realtime.envVar,
      },
    };
  }
}
