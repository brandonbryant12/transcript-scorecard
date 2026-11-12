import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ScorecardDefinitionSchema,
  type ActiveScorecard,
  type ScorecardDefinition,
} from '@scorecard/domain';
import { ScorecardsService } from './scorecards.service.js';

@Controller('scorecard')
export class ScorecardsController {
  constructor(private readonly scorecards: ScorecardsService) {}

  @Get()
  getActive(): Promise<ActiveScorecard> {
    return this.scorecards.getActive();
  }

  @Put()
  publish(
    @Body({ schema: ScorecardDefinitionSchema }) definition: ScorecardDefinition,
  ): Promise<ActiveScorecard> {
    return this.scorecards.publish(definition);
  }
}
