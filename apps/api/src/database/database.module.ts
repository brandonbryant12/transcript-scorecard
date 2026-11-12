import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.js';
import { CallEntity } from '../calls/call.entity.js';
import { ScorecardVersionEntity } from '../scorecards/scorecard-version.entity.js';
import { ScorecardEntity } from '../scorecards/scorecard.entity.js';
import { dataSourceOptions } from './data-source-options.js';
import { SeedService } from './seed/seed.service.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        dataSourceOptions(config.get('SCORECARD_DB_PATH', { infer: true })),
    }),
    TypeOrmModule.forFeature([CallEntity, ScorecardEntity, ScorecardVersionEntity]),
  ],
  providers: [SeedService],
})
export class DatabaseModule {}
