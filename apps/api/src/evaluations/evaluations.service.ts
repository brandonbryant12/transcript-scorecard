import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Evaluation, EvaluationSummary, ScoringProvider } from '@scorecard/domain';
import { Repository, type EntityManager } from 'typeorm';
import { EvaluationEntity } from './evaluation.entity.js';

// The columns a list needs. The document column is deliberately not among them.
const SUMMARY_COLUMNS = [
  'e.id',
  'e.callId',
  'e.runId',
  'e.provider',
  'e.model',
  'e.overallScore',
  'e.confidence',
  'e.needsReview',
  'e.criticalFlagCount',
  'e.latencyMs',
  'e.inputTokens',
  'e.estimatedCostUsd',
  'e.createdAt',
  'v.id',
  'v.version',
];

const toSummary = (entity: EvaluationEntity): EvaluationSummary => ({
  evaluationId: entity.id,
  provider: entity.provider,
  model: entity.model,
  scorecardVersion: entity.scorecardVersion.version,
  overallScore: entity.overallScore,
  confidence: entity.confidence,
  needsReview: entity.needsReview,
  criticalFlags: entity.criticalFlagCount,
  latencyMs: entity.latencyMs,
  inputTokens: entity.inputTokens,
  estimatedCostUsd: entity.estimatedCostUsd,
  createdAt: entity.createdAt,
});

// Keep the first item seen for each key. With rows sorted newest first, that is the
// newest row per key.
const firstPerKey = <T>(items: ReadonlyArray<T>, keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

@Injectable()
export class EvaluationsService {
  constructor(
    @InjectRepository(EvaluationEntity) private readonly evaluations: Repository<EvaluationEntity>,
  ) {}

  // Store an evaluation with its flat skill and behaviour rows in one write.
  async save(
    evaluation: Evaluation,
    manager: EntityManager = this.evaluations.manager,
  ): Promise<void> {
    await manager.save(
      EvaluationEntity,
      manager.create(EvaluationEntity, {
        id: evaluation.id,
        callId: evaluation.callId,
        runId: evaluation.runId,
        provider: evaluation.provider,
        model: evaluation.model,
        scorecardVersionId: evaluation.scorecardVersionId,
        methodVersion: evaluation.methodVersion,
        stage: evaluation.stage,
        turnCount: evaluation.turnCount,
        overallScore: evaluation.overallScore,
        coverage: evaluation.coverage,
        confidence: evaluation.confidence,
        needsReview: evaluation.needsReview,
        criticalFlagCount: evaluation.coaching.flags.length,
        requestCount: evaluation.usage.requests,
        questionCount: evaluation.usage.questions,
        inputTokens: evaluation.usage.inputTokens,
        outputTokens: evaluation.usage.outputTokens,
        latencyMs: evaluation.usage.latencyMs,
        estimatedCostUsd: evaluation.usage.estimatedCostUsd,
        document: evaluation,
        createdAt: evaluation.createdAt,
        skillResults: evaluation.skills.map((skill) => ({
          evaluationId: evaluation.id,
          skillId: skill.skillId,
          channel: skill.channel,
          assessed: skill.assessed,
          weight: skill.weight,
          levelCount: skill.levels.length,
          expectedLevel: skill.expectedLevel,
          level: skill.level,
          normalizedScore: skill.normalizedScore,
          confidence: skill.confidence,
          observability: skill.observability,
        })),
        behaviorResults: evaluation.skills.flatMap((skill) =>
          skill.behaviors.map((behavior) => ({
            evaluationId: evaluation.id,
            behaviorId: behavior.behaviorId,
            skillId: skill.skillId,
            polarity: behavior.polarity,
            status: behavior.status,
            probability: behavior.probability,
          })),
        ),
      }),
    );
  }

  async findDocument(id: string): Promise<Evaluation | null> {
    const entity = await this.evaluations.findOne({
      where: { id },
      select: { id: true, document: true },
    });
    return entity?.document ?? null;
  }

  // The newest final evaluation of every call, from whichever provider produced it.
  async latestFinalByCall(): Promise<ReadonlyMap<string, EvaluationSummary>> {
    const finals = firstPerKey(await this.finalSummaries().getMany(), (entity) => entity.callId);
    return new Map(finals.map((entity) => [entity.callId, toSummary(entity)]));
  }

  // The newest final evaluation of one call from each provider that has scored it.
  async latestFinalsForCall(callId: string): Promise<EvaluationSummary[]> {
    const finals = await this.finalSummaries().andWhere('e.callId = :callId', { callId }).getMany();
    return firstPerKey(finals, (entity) => entity.provider).map(toSummary);
  }

  // The newest final evaluation for every (call, provider) pair, in full. This is what
  // coach reviews are compared against.
  async latestFinalDocuments(): Promise<Evaluation[]> {
    const finals = await this.evaluations.find({
      where: { stage: 'final' },
      select: { id: true, callId: true, provider: true, document: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return firstPerKey(finals, (entity) => `${entity.callId}|${entity.provider}`).map(
      (entity) => entity.document,
    );
  }

  async latestFinalDocumentForCall(
    callId: string,
    provider?: ScoringProvider,
  ): Promise<Evaluation | null> {
    const entity = await this.evaluations.findOne({
      where: { callId, stage: 'final', ...(provider ? { provider } : {}) },
      select: { id: true, document: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return entity?.document ?? null;
  }

  // Every evaluation of one run with its flat skill rows, oldest first: the score
  // history of a live session, or the results of a batch.
  findForRun(runId: string): Promise<EvaluationEntity[]> {
    return this.evaluations.find({
      where: { runId },
      select: {
        id: true,
        callId: true,
        stage: true,
        turnCount: true,
        overallScore: true,
        coverage: true,
        needsReview: true,
        createdAt: true,
      },
      relations: { skillResults: true },
      order: { createdAt: 'ASC', turnCount: 'ASC' },
    });
  }

  private finalSummaries() {
    return this.evaluations
      .createQueryBuilder('e')
      .innerJoin('e.scorecardVersion', 'v')
      .select(SUMMARY_COLUMNS)
      .where("e.stage = 'final'")
      .orderBy('e.createdAt', 'DESC')
      .addOrderBy('e.id', 'DESC');
  }
}
