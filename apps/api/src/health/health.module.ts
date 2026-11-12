import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { PracticeModule } from '../practice/practice.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DecisionsModule, PracticeModule],
  controllers: [HealthController],
})
export class HealthModule {}
