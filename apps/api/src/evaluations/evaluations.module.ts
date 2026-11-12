import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BehaviorResultEntity } from './behavior-result.entity.js';
import { EvaluationEntity } from './evaluation.entity.js';
import { EvaluationsService } from './evaluations.service.js';
import { SkillResultEntity } from './skill-result.entity.js';

// Stores and reads evaluations. It has no controller: evaluations reach the browser as
// part of a call, a run or a live session.
@Module({
  imports: [TypeOrmModule.forFeature([EvaluationEntity, SkillResultEntity, BehaviorResultEntity])],
  providers: [EvaluationsService],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
