import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DEFAULT_SCORECARD_ID, defaultScorecard } from '@scorecard/domain';
import { Repository } from 'typeorm';
import { CallEntity } from '../../calls/call.entity.js';
import { ScorecardVersionEntity } from '../../scorecards/scorecard-version.entity.js';
import { ScorecardEntity } from '../../scorecards/scorecard.entity.js';
import { SEED_CALLS } from './seed-calls.js';

// Puts the demo data in place on first start: the fictional calls and version 1 of the
// default scorecard. Existing rows are left alone, so edits and results survive restarts.
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(CallEntity) private readonly calls: Repository<CallEntity>,
    @InjectRepository(ScorecardEntity) private readonly scorecards: Repository<ScorecardEntity>,
    @InjectRepository(ScorecardVersionEntity)
    private readonly versions: Repository<ScorecardVersionEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.calls
      .createQueryBuilder()
      .insert()
      .values(
        SEED_CALLS.map((call) => ({
          ...call,
          source: 'seed' as const,
          transcript: [...call.transcript],
        })),
      )
      .orIgnore()
      .execute();

    if (await this.scorecards.existsBy({ id: DEFAULT_SCORECARD_ID })) return;
    await this.scorecards.insert({
      id: DEFAULT_SCORECARD_ID,
      name: defaultScorecard.name,
      createdAt,
    });
    await this.versions.insert({
      id: `${DEFAULT_SCORECARD_ID}-v1`,
      scorecardId: DEFAULT_SCORECARD_ID,
      version: 1,
      definition: defaultScorecard,
      createdAt,
    });
  }
}
