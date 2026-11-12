import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { CallsModule } from './calls/calls.module.js';
import { ProviderExceptionFilter } from './common/provider-exception.filter.js';
import { envSchema } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DecisionsModule } from './decisions/decisions.module.js';
import { HealthModule } from './health/health.module.js';
import { LiveModule } from './live/live.module.js';
import { PracticeModule } from './practice/practice.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { RunsModule } from './runs/runs.module.js';
import { ScorecardsModule } from './scorecards/scorecards.module.js';
import { ValidationModule } from './validation/validation.module.js';

@Module({
  imports: [
    // The .env file lives at the repository root; real environment variables win over it.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env'],
      validationSchema: envSchema,
    }),
    DatabaseModule,
    DecisionsModule,
    ScorecardsModule,
    CallsModule,
    RunsModule,
    LiveModule,
    PracticeModule,
    ReviewsModule,
    ValidationModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProviderExceptionFilter }],
})
export class AppModule {}
