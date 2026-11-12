import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1731283200001 implements MigrationInterface {
  name = 'InitialSchema1731283200001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "calls" ("id" text PRIMARY KEY NOT NULL, "customerName" text NOT NULL, "agentName" text NOT NULL, "subject" text NOT NULL, "startedAt" text NOT NULL, "durationSeconds" integer NOT NULL, "source" text NOT NULL, "transcript" text NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE TABLE "scorecards" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "createdAt" text NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE TABLE "scorecard_versions" ("id" text PRIMARY KEY NOT NULL, "scorecardId" text NOT NULL, "version" integer NOT NULL, "definition" text NOT NULL, "createdAt" text NOT NULL, CONSTRAINT "UQ_5fc80e9ee8bb281527a6d2c4aa2" UNIQUE ("scorecardId", "version"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "run_calls" ("runId" text NOT NULL, "callId" text NOT NULL, "position" integer NOT NULL, "status" text NOT NULL, "error" text, "evaluationId" text, "updatedAt" text NOT NULL, PRIMARY KEY ("runId", "callId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scoring_runs" ("id" text PRIMARY KEY NOT NULL, "kind" text NOT NULL, "provider" text NOT NULL, "scorecardVersionId" text NOT NULL, "methodVersion" text NOT NULL, "status" text NOT NULL, "total" integer NOT NULL, "completed" integer NOT NULL DEFAULT (0), "failed" integer NOT NULL DEFAULT (0), "createdAt" text NOT NULL, "startedAt" text, "completedAt" text)`,
    );
    await queryRunner.query(
      `CREATE TABLE "skill_results" ("evaluationId" text NOT NULL, "skillId" text NOT NULL, "channel" text NOT NULL, "assessed" boolean NOT NULL, "weight" real NOT NULL, "levelCount" integer NOT NULL, "expectedLevel" real NOT NULL, "level" integer NOT NULL, "normalizedScore" real NOT NULL, "confidence" real NOT NULL, "observability" real NOT NULL, PRIMARY KEY ("evaluationId", "skillId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "evaluations" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "runId" text NOT NULL, "provider" text NOT NULL, "model" text NOT NULL, "scorecardVersionId" text NOT NULL, "methodVersion" text NOT NULL, "stage" text NOT NULL, "turnCount" integer NOT NULL, "overallScore" real, "coverage" real NOT NULL, "confidence" real NOT NULL, "needsReview" boolean NOT NULL, "criticalFlagCount" integer NOT NULL, "requestCount" integer NOT NULL, "questionCount" integer NOT NULL, "inputTokens" integer NOT NULL, "outputTokens" integer NOT NULL, "latencyMs" integer NOT NULL, "estimatedCostUsd" real NOT NULL, "document" text NOT NULL, "createdAt" text NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a056a4b9afff01c98fd3b3742" ON "evaluations" ("runId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_511a84ccb66642e6fe8401c8f2" ON "evaluations" ("callId", "stage", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "behavior_results" ("evaluationId" text NOT NULL, "behaviorId" text NOT NULL, "skillId" text NOT NULL, "polarity" text NOT NULL, "status" text NOT NULL, "probability" real NOT NULL, PRIMARY KEY ("evaluationId", "behaviorId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "live_sessions" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "runId" text NOT NULL, "provider" text NOT NULL, "scorecardVersionId" text NOT NULL, "source" text NOT NULL, "status" text NOT NULL, "inputComplete" boolean NOT NULL DEFAULT (0), "revealedTurnCount" integer NOT NULL DEFAULT (0), "scoredTurnCount" integer NOT NULL DEFAULT (0), "isProcessing" boolean NOT NULL DEFAULT (0), "requestStartedAt" text, "elapsedMs" integer NOT NULL DEFAULT (0), "revealIntervalMs" integer NOT NULL, "scoreEveryTurns" integer NOT NULL, "state" text NOT NULL, "latestEvaluationId" text, "error" text, "createdAt" text NOT NULL, "updatedAt" text NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE TABLE "coach_skill_ratings" ("reviewId" text NOT NULL, "skillId" text NOT NULL, "level" integer, "note" text NOT NULL, PRIMARY KEY ("reviewId", "skillId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "coach_reviews" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "scorecardVersionId" text NOT NULL, "coachName" text NOT NULL, "status" text NOT NULL, "notes" text NOT NULL, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, "submittedAt" text, CONSTRAINT "UQ_3b10052169fe2069833895eafa5" UNIQUE ("callId", "coachName"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "coach_behavior_labels" ("reviewId" text NOT NULL, "behaviorId" text NOT NULL, "label" text NOT NULL, PRIMARY KEY ("reviewId", "behaviorId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "provider_requests" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "runId" text NOT NULL, "callId" text NOT NULL, "provider" text NOT NULL, "model" text, "stage" text NOT NULL, "turnCount" integer NOT NULL, "questionCount" integer NOT NULL, "inputTokens" integer NOT NULL, "outputTokens" integer NOT NULL, "latencyMs" integer NOT NULL, "estimatedCostUsd" real NOT NULL, "ok" boolean NOT NULL, "startedAt" text NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7f2c19e21b03b99b5c2220dfc" ON "provider_requests" ("runId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_scorecard_versions" ("id" text PRIMARY KEY NOT NULL, "scorecardId" text NOT NULL, "version" integer NOT NULL, "definition" text NOT NULL, "createdAt" text NOT NULL, CONSTRAINT "UQ_5fc80e9ee8bb281527a6d2c4aa2" UNIQUE ("scorecardId", "version"), CONSTRAINT "FK_e49957b0c1c5976da80635ade32" FOREIGN KEY ("scorecardId") REFERENCES "scorecards" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_scorecard_versions"("id", "scorecardId", "version", "definition", "createdAt") SELECT "id", "scorecardId", "version", "definition", "createdAt" FROM "scorecard_versions"`,
    );
    await queryRunner.query(`DROP TABLE "scorecard_versions"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_scorecard_versions" RENAME TO "scorecard_versions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_run_calls" ("runId" text NOT NULL, "callId" text NOT NULL, "position" integer NOT NULL, "status" text NOT NULL, "error" text, "evaluationId" text, "updatedAt" text NOT NULL, CONSTRAINT "FK_6051abe99f763d3c1475f20f8a7" FOREIGN KEY ("runId") REFERENCES "scoring_runs" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_e4916d3713736a3ef815ae3db34" FOREIGN KEY ("callId") REFERENCES "calls" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("runId", "callId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_run_calls"("runId", "callId", "position", "status", "error", "evaluationId", "updatedAt") SELECT "runId", "callId", "position", "status", "error", "evaluationId", "updatedAt" FROM "run_calls"`,
    );
    await queryRunner.query(`DROP TABLE "run_calls"`);
    await queryRunner.query(`ALTER TABLE "temporary_run_calls" RENAME TO "run_calls"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_scoring_runs" ("id" text PRIMARY KEY NOT NULL, "kind" text NOT NULL, "provider" text NOT NULL, "scorecardVersionId" text NOT NULL, "methodVersion" text NOT NULL, "status" text NOT NULL, "total" integer NOT NULL, "completed" integer NOT NULL DEFAULT (0), "failed" integer NOT NULL DEFAULT (0), "createdAt" text NOT NULL, "startedAt" text, "completedAt" text, CONSTRAINT "FK_15994b2f079481db112d5644797" FOREIGN KEY ("scorecardVersionId") REFERENCES "scorecard_versions" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_scoring_runs"("id", "kind", "provider", "scorecardVersionId", "methodVersion", "status", "total", "completed", "failed", "createdAt", "startedAt", "completedAt") SELECT "id", "kind", "provider", "scorecardVersionId", "methodVersion", "status", "total", "completed", "failed", "createdAt", "startedAt", "completedAt" FROM "scoring_runs"`,
    );
    await queryRunner.query(`DROP TABLE "scoring_runs"`);
    await queryRunner.query(`ALTER TABLE "temporary_scoring_runs" RENAME TO "scoring_runs"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_skill_results" ("evaluationId" text NOT NULL, "skillId" text NOT NULL, "channel" text NOT NULL, "assessed" boolean NOT NULL, "weight" real NOT NULL, "levelCount" integer NOT NULL, "expectedLevel" real NOT NULL, "level" integer NOT NULL, "normalizedScore" real NOT NULL, "confidence" real NOT NULL, "observability" real NOT NULL, CONSTRAINT "FK_763ecbae1fe8d2e82cdf538af5a" FOREIGN KEY ("evaluationId") REFERENCES "evaluations" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("evaluationId", "skillId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_skill_results"("evaluationId", "skillId", "channel", "assessed", "weight", "levelCount", "expectedLevel", "level", "normalizedScore", "confidence", "observability") SELECT "evaluationId", "skillId", "channel", "assessed", "weight", "levelCount", "expectedLevel", "level", "normalizedScore", "confidence", "observability" FROM "skill_results"`,
    );
    await queryRunner.query(`DROP TABLE "skill_results"`);
    await queryRunner.query(`ALTER TABLE "temporary_skill_results" RENAME TO "skill_results"`);
    await queryRunner.query(`DROP INDEX "IDX_0a056a4b9afff01c98fd3b3742"`);
    await queryRunner.query(`DROP INDEX "IDX_511a84ccb66642e6fe8401c8f2"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_evaluations" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "runId" text NOT NULL, "provider" text NOT NULL, "model" text NOT NULL, "scorecardVersionId" text NOT NULL, "methodVersion" text NOT NULL, "stage" text NOT NULL, "turnCount" integer NOT NULL, "overallScore" real, "coverage" real NOT NULL, "confidence" real NOT NULL, "needsReview" boolean NOT NULL, "criticalFlagCount" integer NOT NULL, "requestCount" integer NOT NULL, "questionCount" integer NOT NULL, "inputTokens" integer NOT NULL, "outputTokens" integer NOT NULL, "latencyMs" integer NOT NULL, "estimatedCostUsd" real NOT NULL, "document" text NOT NULL, "createdAt" text NOT NULL, CONSTRAINT "FK_a17f2cc1dc12f5fb93893ffe2c0" FOREIGN KEY ("callId") REFERENCES "calls" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_77ad1e695d307581e4f822bedea" FOREIGN KEY ("runId") REFERENCES "scoring_runs" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_5956bf12e8cd6363238cb38b5c4" FOREIGN KEY ("scorecardVersionId") REFERENCES "scorecard_versions" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_evaluations"("id", "callId", "runId", "provider", "model", "scorecardVersionId", "methodVersion", "stage", "turnCount", "overallScore", "coverage", "confidence", "needsReview", "criticalFlagCount", "requestCount", "questionCount", "inputTokens", "outputTokens", "latencyMs", "estimatedCostUsd", "document", "createdAt") SELECT "id", "callId", "runId", "provider", "model", "scorecardVersionId", "methodVersion", "stage", "turnCount", "overallScore", "coverage", "confidence", "needsReview", "criticalFlagCount", "requestCount", "questionCount", "inputTokens", "outputTokens", "latencyMs", "estimatedCostUsd", "document", "createdAt" FROM "evaluations"`,
    );
    await queryRunner.query(`DROP TABLE "evaluations"`);
    await queryRunner.query(`ALTER TABLE "temporary_evaluations" RENAME TO "evaluations"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_0a056a4b9afff01c98fd3b3742" ON "evaluations" ("runId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_511a84ccb66642e6fe8401c8f2" ON "evaluations" ("callId", "stage", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_behavior_results" ("evaluationId" text NOT NULL, "behaviorId" text NOT NULL, "skillId" text NOT NULL, "polarity" text NOT NULL, "status" text NOT NULL, "probability" real NOT NULL, CONSTRAINT "FK_ba775013773cbf97d2ba957290f" FOREIGN KEY ("evaluationId") REFERENCES "evaluations" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("evaluationId", "behaviorId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_behavior_results"("evaluationId", "behaviorId", "skillId", "polarity", "status", "probability") SELECT "evaluationId", "behaviorId", "skillId", "polarity", "status", "probability" FROM "behavior_results"`,
    );
    await queryRunner.query(`DROP TABLE "behavior_results"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_behavior_results" RENAME TO "behavior_results"`,
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_live_sessions" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "runId" text NOT NULL, "provider" text NOT NULL, "scorecardVersionId" text NOT NULL, "source" text NOT NULL, "status" text NOT NULL, "inputComplete" boolean NOT NULL DEFAULT (0), "revealedTurnCount" integer NOT NULL DEFAULT (0), "scoredTurnCount" integer NOT NULL DEFAULT (0), "isProcessing" boolean NOT NULL DEFAULT (0), "requestStartedAt" text, "elapsedMs" integer NOT NULL DEFAULT (0), "revealIntervalMs" integer NOT NULL, "scoreEveryTurns" integer NOT NULL, "state" text NOT NULL, "latestEvaluationId" text, "error" text, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, CONSTRAINT "FK_cd3ad6a1226791e927f4682f110" FOREIGN KEY ("callId") REFERENCES "calls" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_73568512e82fe9ecde7dcd5376c" FOREIGN KEY ("runId") REFERENCES "scoring_runs" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_ddf17ee0a1bb0184878265e0281" FOREIGN KEY ("scorecardVersionId") REFERENCES "scorecard_versions" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_live_sessions"("id", "callId", "runId", "provider", "scorecardVersionId", "source", "status", "inputComplete", "revealedTurnCount", "scoredTurnCount", "isProcessing", "requestStartedAt", "elapsedMs", "revealIntervalMs", "scoreEveryTurns", "state", "latestEvaluationId", "error", "createdAt", "updatedAt") SELECT "id", "callId", "runId", "provider", "scorecardVersionId", "source", "status", "inputComplete", "revealedTurnCount", "scoredTurnCount", "isProcessing", "requestStartedAt", "elapsedMs", "revealIntervalMs", "scoreEveryTurns", "state", "latestEvaluationId", "error", "createdAt", "updatedAt" FROM "live_sessions"`,
    );
    await queryRunner.query(`DROP TABLE "live_sessions"`);
    await queryRunner.query(`ALTER TABLE "temporary_live_sessions" RENAME TO "live_sessions"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_coach_skill_ratings" ("reviewId" text NOT NULL, "skillId" text NOT NULL, "level" integer, "note" text NOT NULL, CONSTRAINT "FK_b4b30b2cb5027689eb4d617214a" FOREIGN KEY ("reviewId") REFERENCES "coach_reviews" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("reviewId", "skillId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_coach_skill_ratings"("reviewId", "skillId", "level", "note") SELECT "reviewId", "skillId", "level", "note" FROM "coach_skill_ratings"`,
    );
    await queryRunner.query(`DROP TABLE "coach_skill_ratings"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_coach_skill_ratings" RENAME TO "coach_skill_ratings"`,
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_coach_reviews" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "scorecardVersionId" text NOT NULL, "coachName" text NOT NULL, "status" text NOT NULL, "notes" text NOT NULL, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, "submittedAt" text, CONSTRAINT "UQ_3b10052169fe2069833895eafa5" UNIQUE ("callId", "coachName"), CONSTRAINT "FK_d7c3462c1032e4cf5bf02a6529d" FOREIGN KEY ("callId") REFERENCES "calls" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_740501e9f66fa4c3358591d63b1" FOREIGN KEY ("scorecardVersionId") REFERENCES "scorecard_versions" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_coach_reviews"("id", "callId", "scorecardVersionId", "coachName", "status", "notes", "createdAt", "updatedAt", "submittedAt") SELECT "id", "callId", "scorecardVersionId", "coachName", "status", "notes", "createdAt", "updatedAt", "submittedAt" FROM "coach_reviews"`,
    );
    await queryRunner.query(`DROP TABLE "coach_reviews"`);
    await queryRunner.query(`ALTER TABLE "temporary_coach_reviews" RENAME TO "coach_reviews"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_coach_behavior_labels" ("reviewId" text NOT NULL, "behaviorId" text NOT NULL, "label" text NOT NULL, CONSTRAINT "FK_eb7c3ba2243024d90a4d9543e2a" FOREIGN KEY ("reviewId") REFERENCES "coach_reviews" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("reviewId", "behaviorId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "temporary_coach_behavior_labels"("reviewId", "behaviorId", "label") SELECT "reviewId", "behaviorId", "label" FROM "coach_behavior_labels"`,
    );
    await queryRunner.query(`DROP TABLE "coach_behavior_labels"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_coach_behavior_labels" RENAME TO "coach_behavior_labels"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coach_behavior_labels" RENAME TO "temporary_coach_behavior_labels"`,
    );
    await queryRunner.query(
      `CREATE TABLE "coach_behavior_labels" ("reviewId" text NOT NULL, "behaviorId" text NOT NULL, "label" text NOT NULL, PRIMARY KEY ("reviewId", "behaviorId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "coach_behavior_labels"("reviewId", "behaviorId", "label") SELECT "reviewId", "behaviorId", "label" FROM "temporary_coach_behavior_labels"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_coach_behavior_labels"`);
    await queryRunner.query(`ALTER TABLE "coach_reviews" RENAME TO "temporary_coach_reviews"`);
    await queryRunner.query(
      `CREATE TABLE "coach_reviews" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "scorecardVersionId" text NOT NULL, "coachName" text NOT NULL, "status" text NOT NULL, "notes" text NOT NULL, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, "submittedAt" text, CONSTRAINT "UQ_3b10052169fe2069833895eafa5" UNIQUE ("callId", "coachName"))`,
    );
    await queryRunner.query(
      `INSERT INTO "coach_reviews"("id", "callId", "scorecardVersionId", "coachName", "status", "notes", "createdAt", "updatedAt", "submittedAt") SELECT "id", "callId", "scorecardVersionId", "coachName", "status", "notes", "createdAt", "updatedAt", "submittedAt" FROM "temporary_coach_reviews"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_coach_reviews"`);
    await queryRunner.query(
      `ALTER TABLE "coach_skill_ratings" RENAME TO "temporary_coach_skill_ratings"`,
    );
    await queryRunner.query(
      `CREATE TABLE "coach_skill_ratings" ("reviewId" text NOT NULL, "skillId" text NOT NULL, "level" integer, "note" text NOT NULL, PRIMARY KEY ("reviewId", "skillId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "coach_skill_ratings"("reviewId", "skillId", "level", "note") SELECT "reviewId", "skillId", "level", "note" FROM "temporary_coach_skill_ratings"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_coach_skill_ratings"`);
    await queryRunner.query(`ALTER TABLE "live_sessions" RENAME TO "temporary_live_sessions"`);
    await queryRunner.query(
      `CREATE TABLE "live_sessions" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "runId" text NOT NULL, "provider" text NOT NULL, "scorecardVersionId" text NOT NULL, "source" text NOT NULL, "status" text NOT NULL, "inputComplete" boolean NOT NULL DEFAULT (0), "revealedTurnCount" integer NOT NULL DEFAULT (0), "scoredTurnCount" integer NOT NULL DEFAULT (0), "isProcessing" boolean NOT NULL DEFAULT (0), "requestStartedAt" text, "elapsedMs" integer NOT NULL DEFAULT (0), "revealIntervalMs" integer NOT NULL, "scoreEveryTurns" integer NOT NULL, "state" text NOT NULL, "latestEvaluationId" text, "error" text, "createdAt" text NOT NULL, "updatedAt" text NOT NULL)`,
    );
    await queryRunner.query(
      `INSERT INTO "live_sessions"("id", "callId", "runId", "provider", "scorecardVersionId", "source", "status", "inputComplete", "revealedTurnCount", "scoredTurnCount", "isProcessing", "requestStartedAt", "elapsedMs", "revealIntervalMs", "scoreEveryTurns", "state", "latestEvaluationId", "error", "createdAt", "updatedAt") SELECT "id", "callId", "runId", "provider", "scorecardVersionId", "source", "status", "inputComplete", "revealedTurnCount", "scoredTurnCount", "isProcessing", "requestStartedAt", "elapsedMs", "revealIntervalMs", "scoreEveryTurns", "state", "latestEvaluationId", "error", "createdAt", "updatedAt" FROM "temporary_live_sessions"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_live_sessions"`);
    await queryRunner.query(
      `ALTER TABLE "behavior_results" RENAME TO "temporary_behavior_results"`,
    );
    await queryRunner.query(
      `CREATE TABLE "behavior_results" ("evaluationId" text NOT NULL, "behaviorId" text NOT NULL, "skillId" text NOT NULL, "polarity" text NOT NULL, "status" text NOT NULL, "probability" real NOT NULL, PRIMARY KEY ("evaluationId", "behaviorId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "behavior_results"("evaluationId", "behaviorId", "skillId", "polarity", "status", "probability") SELECT "evaluationId", "behaviorId", "skillId", "polarity", "status", "probability" FROM "temporary_behavior_results"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_behavior_results"`);
    await queryRunner.query(`DROP INDEX "IDX_511a84ccb66642e6fe8401c8f2"`);
    await queryRunner.query(`DROP INDEX "IDX_0a056a4b9afff01c98fd3b3742"`);
    await queryRunner.query(`ALTER TABLE "evaluations" RENAME TO "temporary_evaluations"`);
    await queryRunner.query(
      `CREATE TABLE "evaluations" ("id" text PRIMARY KEY NOT NULL, "callId" text NOT NULL, "runId" text NOT NULL, "provider" text NOT NULL, "model" text NOT NULL, "scorecardVersionId" text NOT NULL, "methodVersion" text NOT NULL, "stage" text NOT NULL, "turnCount" integer NOT NULL, "overallScore" real, "coverage" real NOT NULL, "confidence" real NOT NULL, "needsReview" boolean NOT NULL, "criticalFlagCount" integer NOT NULL, "requestCount" integer NOT NULL, "questionCount" integer NOT NULL, "inputTokens" integer NOT NULL, "outputTokens" integer NOT NULL, "latencyMs" integer NOT NULL, "estimatedCostUsd" real NOT NULL, "document" text NOT NULL, "createdAt" text NOT NULL)`,
    );
    await queryRunner.query(
      `INSERT INTO "evaluations"("id", "callId", "runId", "provider", "model", "scorecardVersionId", "methodVersion", "stage", "turnCount", "overallScore", "coverage", "confidence", "needsReview", "criticalFlagCount", "requestCount", "questionCount", "inputTokens", "outputTokens", "latencyMs", "estimatedCostUsd", "document", "createdAt") SELECT "id", "callId", "runId", "provider", "model", "scorecardVersionId", "methodVersion", "stage", "turnCount", "overallScore", "coverage", "confidence", "needsReview", "criticalFlagCount", "requestCount", "questionCount", "inputTokens", "outputTokens", "latencyMs", "estimatedCostUsd", "document", "createdAt" FROM "temporary_evaluations"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_evaluations"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_511a84ccb66642e6fe8401c8f2" ON "evaluations" ("callId", "stage", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a056a4b9afff01c98fd3b3742" ON "evaluations" ("runId", "createdAt") `,
    );
    await queryRunner.query(`ALTER TABLE "skill_results" RENAME TO "temporary_skill_results"`);
    await queryRunner.query(
      `CREATE TABLE "skill_results" ("evaluationId" text NOT NULL, "skillId" text NOT NULL, "channel" text NOT NULL, "assessed" boolean NOT NULL, "weight" real NOT NULL, "levelCount" integer NOT NULL, "expectedLevel" real NOT NULL, "level" integer NOT NULL, "normalizedScore" real NOT NULL, "confidence" real NOT NULL, "observability" real NOT NULL, PRIMARY KEY ("evaluationId", "skillId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "skill_results"("evaluationId", "skillId", "channel", "assessed", "weight", "levelCount", "expectedLevel", "level", "normalizedScore", "confidence", "observability") SELECT "evaluationId", "skillId", "channel", "assessed", "weight", "levelCount", "expectedLevel", "level", "normalizedScore", "confidence", "observability" FROM "temporary_skill_results"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_skill_results"`);
    await queryRunner.query(`ALTER TABLE "scoring_runs" RENAME TO "temporary_scoring_runs"`);
    await queryRunner.query(
      `CREATE TABLE "scoring_runs" ("id" text PRIMARY KEY NOT NULL, "kind" text NOT NULL, "provider" text NOT NULL, "scorecardVersionId" text NOT NULL, "methodVersion" text NOT NULL, "status" text NOT NULL, "total" integer NOT NULL, "completed" integer NOT NULL DEFAULT (0), "failed" integer NOT NULL DEFAULT (0), "createdAt" text NOT NULL, "startedAt" text, "completedAt" text)`,
    );
    await queryRunner.query(
      `INSERT INTO "scoring_runs"("id", "kind", "provider", "scorecardVersionId", "methodVersion", "status", "total", "completed", "failed", "createdAt", "startedAt", "completedAt") SELECT "id", "kind", "provider", "scorecardVersionId", "methodVersion", "status", "total", "completed", "failed", "createdAt", "startedAt", "completedAt" FROM "temporary_scoring_runs"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_scoring_runs"`);
    await queryRunner.query(`ALTER TABLE "run_calls" RENAME TO "temporary_run_calls"`);
    await queryRunner.query(
      `CREATE TABLE "run_calls" ("runId" text NOT NULL, "callId" text NOT NULL, "position" integer NOT NULL, "status" text NOT NULL, "error" text, "evaluationId" text, "updatedAt" text NOT NULL, PRIMARY KEY ("runId", "callId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "run_calls"("runId", "callId", "position", "status", "error", "evaluationId", "updatedAt") SELECT "runId", "callId", "position", "status", "error", "evaluationId", "updatedAt" FROM "temporary_run_calls"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_run_calls"`);
    await queryRunner.query(
      `ALTER TABLE "scorecard_versions" RENAME TO "temporary_scorecard_versions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "scorecard_versions" ("id" text PRIMARY KEY NOT NULL, "scorecardId" text NOT NULL, "version" integer NOT NULL, "definition" text NOT NULL, "createdAt" text NOT NULL, CONSTRAINT "UQ_5fc80e9ee8bb281527a6d2c4aa2" UNIQUE ("scorecardId", "version"))`,
    );
    await queryRunner.query(
      `INSERT INTO "scorecard_versions"("id", "scorecardId", "version", "definition", "createdAt") SELECT "id", "scorecardId", "version", "definition", "createdAt" FROM "temporary_scorecard_versions"`,
    );
    await queryRunner.query(`DROP TABLE "temporary_scorecard_versions"`);
    await queryRunner.query(`DROP INDEX "IDX_d7f2c19e21b03b99b5c2220dfc"`);
    await queryRunner.query(`DROP TABLE "provider_requests"`);
    await queryRunner.query(`DROP TABLE "coach_behavior_labels"`);
    await queryRunner.query(`DROP TABLE "coach_reviews"`);
    await queryRunner.query(`DROP TABLE "coach_skill_ratings"`);
    await queryRunner.query(`DROP TABLE "live_sessions"`);
    await queryRunner.query(`DROP TABLE "behavior_results"`);
    await queryRunner.query(`DROP INDEX "IDX_511a84ccb66642e6fe8401c8f2"`);
    await queryRunner.query(`DROP INDEX "IDX_0a056a4b9afff01c98fd3b3742"`);
    await queryRunner.query(`DROP TABLE "evaluations"`);
    await queryRunner.query(`DROP TABLE "skill_results"`);
    await queryRunner.query(`DROP TABLE "scoring_runs"`);
    await queryRunner.query(`DROP TABLE "run_calls"`);
    await queryRunner.query(`DROP TABLE "scorecard_versions"`);
    await queryRunner.query(`DROP TABLE "scorecards"`);
    await queryRunner.query(`DROP TABLE "calls"`);
  }
}
