import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { SpendSummary, SpendTotals } from '@scorecard/domain';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { CallEntity } from '../calls/call.entity.js';
import { ProviderRequestEntity } from '../runs/provider-request.entity.js';
import { ScoringRunEntity } from '../runs/scoring-run.entity.js';
import {
  kindLines,
  priceList,
  providerLines,
  SPEND_EXCLUSIONS,
  toLedgerRow,
  toTotals,
  utcDay,
  utcDayStart,
  type RawLedgerRow,
  type RawTotals,
} from './spend-summary.js';

const RECENT_ROWS = 50;

// The kind of work behind a ledger row, worked out from what the row belongs to.
// - A batch run's requests are batch work, whatever call they scored.
// - A live run's kind is its session's source. A live run with no session is one a replay
//   reset replaced (the session moves on to a new run, the old run keeps its requests);
//   only replays can be reset, so it is a replay.
// - A stream whose call subject starts with "Practice" is a practice call: the practice
//   scenarios all name their calls that way. GLOB is case-sensitive, unlike LIKE.
// The session is looked up with a subquery so a row can never be counted twice.
const KIND_SQL = `CASE
  WHEN r.kind = 'batch' THEN 'batch'
  WHEN COALESCE(
    (SELECT s.source FROM live_sessions s WHERE s.runId = p.runId LIMIT 1),
    'replay'
  ) = 'replay' THEN 'replay'
  WHEN c.subject GLOB 'Practice*' THEN 'practice'
  ELSE 'stream'
END`;

// The spending ledger: the per-request rows in provider_requests, summed across runs.
// Everything is aggregated in SQLite; only the 50 most recent rows are read as rows.
@Injectable()
export class SpendService {
  constructor(
    @InjectRepository(ProviderRequestEntity)
    private readonly requests: Repository<ProviderRequestEntity>,
  ) {}

  async summary(days: number, now = new Date()): Promise<SpendSummary> {
    const [allTime, today, last7Days, byProvider, byKind, byDay, recent] = await Promise.all([
      this.totals(),
      this.totals(utcDayStart(now)),
      this.totals(utcDayStart(now, 6)),
      this.withTotals(this.requests.createQueryBuilder('p'))
        .addSelect('p.provider', 'provider')
        .groupBy('p.provider')
        .getRawMany<RawTotals & { provider: string }>(),
      // Grouped by the expression, not the alias: SQLite resolves `GROUP BY kind` to the
      // run's own `kind` column (batch or live) before it looks at output aliases.
      this.withTotals(this.joined())
        .addSelect(KIND_SQL, 'kind')
        .groupBy(KIND_SQL)
        .getRawMany<RawTotals & { kind: string }>(),
      // A row's day is the date part of its UTC timestamp; see utcDay in spend-summary.ts.
      this.withTotals(this.requests.createQueryBuilder('p'))
        .addSelect('substr(p.startedAt, 1, 10)', 'day')
        .groupBy('day')
        .orderBy('day', 'DESC')
        .limit(days)
        .getRawMany<RawTotals & { day: string }>(),
      this.joined()
        .select('p.id', 'id')
        .addSelect('p.startedAt', 'startedAt')
        .addSelect('p.runId', 'runId')
        .addSelect('p.callId', 'callId')
        .addSelect('p.provider', 'provider')
        .addSelect('p.model', 'model')
        .addSelect(KIND_SQL, 'kind')
        .addSelect('c.subject', 'subject')
        .addSelect('p.questionCount', 'questionCount')
        .addSelect('p.inputTokens', 'inputTokens')
        .addSelect('p.outputTokens', 'outputTokens')
        .addSelect('p.latencyMs', 'latencyMs')
        .addSelect('p.estimatedCostUsd', 'estimatedCostUsd')
        .addSelect('p.ok', 'ok')
        .orderBy('p.startedAt', 'DESC')
        .addOrderBy('p.id', 'DESC')
        .limit(RECENT_ROWS)
        .getRawMany<RawLedgerRow>(),
    ]);

    return {
      generatedAt: now.toISOString(),
      today: utcDay(now),
      days,
      prices: priceList(),
      totals: { allTime, today, last7Days },
      byProvider: providerLines(byProvider),
      byKind: kindLines(byKind),
      byDay: byDay.map(({ day, ...totals }) => ({ day, ...toTotals(totals) })),
      recent: recent.map(toLedgerRow),
      excluded: SPEND_EXCLUSIONS,
    };
  }

  // Totals over every row, or over the rows made at or after `since` (an ISO timestamp).
  private async totals(since?: string): Promise<SpendTotals> {
    const query = this.withTotals(this.requests.createQueryBuilder('p'));
    if (since !== undefined) query.where('p.startedAt >= :since', { since });
    return toTotals(await query.getRawOne<RawTotals>());
  }

  // The ledger with the run and the call each row belongs to, for its kind and subject.
  private joined(): SelectQueryBuilder<ProviderRequestEntity> {
    return this.requests
      .createQueryBuilder('p')
      .leftJoin(ScoringRunEntity, 'r', 'r.id = p.runId')
      .leftJoin(CallEntity, 'c', 'c.id = p.callId');
  }

  // A failed request is stored with no tokens and no cost, so plain sums already leave
  // it out of tokens and cost while it still counts as a request.
  private withTotals(
    query: SelectQueryBuilder<ProviderRequestEntity>,
  ): SelectQueryBuilder<ProviderRequestEntity> {
    return query
      .select('COUNT(*)', 'requests')
      .addSelect('COALESCE(SUM(CASE WHEN p.ok THEN 0 ELSE 1 END), 0)', 'failedRequests')
      .addSelect('COALESCE(SUM(p.questionCount), 0)', 'questions')
      .addSelect('COALESCE(SUM(p.inputTokens), 0)', 'inputTokens')
      .addSelect('COALESCE(SUM(p.outputTokens), 0)', 'outputTokens')
      .addSelect('COALESCE(SUM(p.estimatedCostUsd), 0)', 'estimatedCostUsd');
  }
}
