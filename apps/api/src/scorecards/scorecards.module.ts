import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScorecardVersionEntity } from './scorecard-version.entity.js';
import { ScorecardEntity } from './scorecard.entity.js';
import { ScorecardsController } from './scorecards.controller.js';
import { ScorecardsService } from './scorecards.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ScorecardEntity, ScorecardVersionEntity])],
  controllers: [ScorecardsController],
  providers: [ScorecardsService],
  exports: [ScorecardsService],
})
export class ScorecardsModule {}
