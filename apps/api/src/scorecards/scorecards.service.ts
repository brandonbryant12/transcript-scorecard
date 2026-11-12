import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DEFAULT_SCORECARD_ID,
  scorecardProblems,
  type ActiveScorecard,
  type ScorecardDefinition,
  type ScorecardVersion,
} from '@scorecard/domain';
import { Repository } from 'typeorm';
import { ScorecardVersionEntity } from './scorecard-version.entity.js';
import { ScorecardEntity } from './scorecard.entity.js';

const toVersion = (entity: ScorecardVersionEntity): ScorecardVersion => ({
  id: entity.id,
  scorecardId: entity.scorecardId,
  version: entity.version,
  definition: entity.definition,
  createdAt: entity.createdAt,
});

@Injectable()
export class ScorecardsService {
  constructor(
    @InjectRepository(ScorecardEntity) private readonly scorecards: Repository<ScorecardEntity>,
    @InjectRepository(ScorecardVersionEntity)
    private readonly versions: Repository<ScorecardVersionEntity>,
  ) {}

  async findVersion(id: string): Promise<ScorecardVersion | null> {
    const entity = await this.versions.findOneBy({ id });
    return entity ? toVersion(entity) : null;
  }

  // The active scorecard is simply the newest version. Older versions stay readable
  // because the evaluations and reviews made against them still point at them.
  async getActive(): Promise<ActiveScorecard> {
    const all = await this.versions.find({
      where: { scorecardId: DEFAULT_SCORECARD_ID },
      order: { version: 'DESC' },
    });
    const [active] = all;
    if (!active) throw new Error('The default scorecard has not been seeded');
    return {
      ...toVersion(active),
      versions: all.map(({ id, version, createdAt }) => ({ id, version, createdAt })),
    };
  }

  // Publishing never edits in place: it inserts the next version. An unchanged
  // definition publishes nothing.
  async publish(definition: ScorecardDefinition): Promise<ActiveScorecard> {
    const problems = scorecardProblems(definition);
    if (problems.length > 0) throw new BadRequestException(problems);

    const active = await this.getActive();
    if (JSON.stringify(definition) === JSON.stringify(active.definition)) return active;

    const version = active.version + 1;
    await this.versions.insert({
      id: `${DEFAULT_SCORECARD_ID}-v${version}`,
      scorecardId: DEFAULT_SCORECARD_ID,
      version,
      definition,
      createdAt: new Date().toISOString(),
    });
    await this.scorecards.update({ id: DEFAULT_SCORECARD_ID }, { name: definition.name });
    return this.getActive();
  }
}
