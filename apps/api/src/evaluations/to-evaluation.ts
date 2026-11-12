import { SCORING_METHOD, type Evaluation, type ScoringProvider } from '@scorecard/domain';
import { randomUUID } from 'node:crypto';
import type { ScoreOutput } from '../scoring/scoring-engine.service.js';

// Stamp one scoring pass with where it came from, making it a storable evaluation.
export const toEvaluation = (
  output: ScoreOutput,
  origin: {
    readonly callId: string;
    readonly runId: string;
    readonly provider: ScoringProvider;
    readonly scorecardVersionId: string;
  },
): Evaluation => ({
  ...output.body,
  ...origin,
  id: `evaluation-${randomUUID()}`,
  model: output.model,
  methodVersion: SCORING_METHOD.version,
  usage: output.usage,
  createdAt: new Date().toISOString(),
});
