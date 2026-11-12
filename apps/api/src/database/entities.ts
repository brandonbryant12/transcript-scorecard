import { CallEntity } from '../calls/call.entity.js';
import { BehaviorResultEntity } from '../evaluations/behavior-result.entity.js';
import { EvaluationEntity } from '../evaluations/evaluation.entity.js';
import { SkillResultEntity } from '../evaluations/skill-result.entity.js';
import { LiveSessionEntity } from '../live/live-session.entity.js';
import { CoachBehaviorLabelEntity } from '../reviews/coach-behavior-label.entity.js';
import { CoachReviewEntity } from '../reviews/coach-review.entity.js';
import { CoachSkillRatingEntity } from '../reviews/coach-skill-rating.entity.js';
import { ProviderRequestEntity } from '../runs/provider-request.entity.js';
import { RunCallEntity } from '../runs/run-call.entity.js';
import { ScoringRunEntity } from '../runs/scoring-run.entity.js';
import { ScorecardVersionEntity } from '../scorecards/scorecard-version.entity.js';
import { ScorecardEntity } from '../scorecards/scorecard.entity.js';

// Every table in one list, shared by the running application and the TypeORM CLI.
export const ENTITIES = [
  ScorecardEntity,
  ScorecardVersionEntity,
  CallEntity,
  ScoringRunEntity,
  RunCallEntity,
  ProviderRequestEntity,
  EvaluationEntity,
  SkillResultEntity,
  BehaviorResultEntity,
  LiveSessionEntity,
  CoachReviewEntity,
  CoachSkillRatingEntity,
  CoachBehaviorLabelEntity,
];
