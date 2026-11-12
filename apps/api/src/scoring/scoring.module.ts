import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { ScoringEngine } from './scoring-engine.service.js';

// Turns a transcript (and optional audio and video) into an evaluation. It knows the
// scoring method and nothing about HTTP or the database.
@Module({
  imports: [DecisionsModule],
  providers: [ScoringEngine],
  exports: [ScoringEngine, DecisionsModule],
})
export class ScoringModule {}
