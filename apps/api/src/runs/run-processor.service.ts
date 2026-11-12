import { Injectable, Logger } from '@nestjs/common';
import { emptyScoringState } from '@scorecard/domain';
import { CallsService } from '../calls/calls.service.js';
import { ProviderError } from '../decisions/provider.error.js';
import { toEvaluation } from '../evaluations/to-evaluation.js';
import { EvaluationsService } from '../evaluations/evaluations.service.js';
import { ScorecardsService } from '../scorecards/scorecards.service.js';
import { ScoringEngine } from '../scoring/scoring-engine.service.js';
import { RunsService, type BatchRun } from './runs.service.js';

const CONCURRENT_CALLS = 2;

// Works through a batch run: every call scored once against its complete transcript.
// A failed call is recorded with a safe message and never stops the rest of the run.
@Injectable()
export class RunProcessor {
  private readonly logger = new Logger(RunProcessor.name);

  constructor(
    private readonly runs: RunsService,
    private readonly calls: CallsService,
    private readonly scorecards: ScorecardsService,
    private readonly evaluations: EvaluationsService,
    private readonly engine: ScoringEngine,
  ) {}

  async process(run: BatchRun): Promise<void> {
    await this.runs.markStarted(run.runId);
    const queue = [...run.callIds];
    const worker = async (): Promise<void> => {
      for (let callId = queue.shift(); callId !== undefined; callId = queue.shift()) {
        await this.scoreCall(run, callId);
      }
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENT_CALLS }, worker));
    } finally {
      await this.runs.finishBatch(run.runId);
    }
  }

  private async scoreCall(run: BatchRun, callId: string): Promise<void> {
    const { runId, provider, scorecardVersionId } = run;
    await this.runs.markCallProcessing(runId, callId);
    try {
      const [call, scorecard] = await Promise.all([
        this.calls.findEntity(callId),
        this.scorecards.findVersion(scorecardVersionId),
      ]);
      if (!call || !scorecard) throw new Error('Call or scorecard no longer exists');
      const output = await this.engine.score({
        provider,
        call,
        definition: scorecard.definition,
        turns: call.transcript,
        state: emptyScoringState,
        stage: 'final',
        onRequest: (record) =>
          this.runs.recordRequest(
            { runId, callId, provider },
            'final',
            call.transcript.length,
            record,
          ),
      });
      const evaluation = toEvaluation(output, { callId, runId, provider, scorecardVersionId });
      await this.evaluations.save(evaluation);
      await this.runs.completeCall(runId, callId, evaluation.id);
    } catch (cause) {
      if (!(cause instanceof ProviderError)) this.logger.error(`Scoring ${callId} failed`, cause);
      await this.runs.failCall(runId, callId, ProviderError.publicMessage(cause, provider));
    }
  }
}
