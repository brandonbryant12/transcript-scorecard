import type { CallDetail, CallSummary, Criterion, LiveSessionDetail, Run, RunDetail } from "@scorecard/domain";

export type { CallDetail, CallStatus, CallSummary, Criterion, LiveSessionDetail } from "@scorecard/domain";

export interface DashboardData {
  totals: { reviewedCalls: number; averageScore: number; passRate: number; needsAttention: number };
  scoreTrend: Array<{ id: string; label: string; score: number }>;
  criterionPerformance: Array<{ criterionId: string; name: string; average: number; target: number }>;
  recentCalls: CallSummary[];
}

export interface BatchJob {
  id: string;
  status: Run["status"];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ callId: string; message: string }>;
}

interface DashboardResponse {
  evaluatedCalls: number;
  failedCalls: number;
  averageScore: number;
  latestRun: Run | null;
}

export interface LivePacing {
  intervalMs?: number;
  scoreEveryTurns?: number;
}

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function toBatchJob(run: Run | RunDetail): BatchJob {
  const results = "results" in run ? run.results : [];
  return {
    id: run.id,
    status: run.status,
    total: run.total,
    processed: run.completed,
    succeeded: Math.max(0, run.completed - run.failed),
    failed: run.failed,
    errors: results.flatMap((result) => result.error ? [{ callId: result.callId, message: result.error }] : []),
  };
}

async function dashboard(): Promise<DashboardData> {
  const [summary, calls] = await Promise.all([
    request<DashboardResponse>("/dashboard"),
    request<CallSummary[]>("/calls"),
  ]);
  const evaluated = calls.filter((call) => call.status === "completed" && call.overallScore !== null);
  const details = await Promise.all(evaluated.map((call) => request<CallDetail>(`/calls/${call.id}`)));
  const criterionGroups = new Map<string, { name: string; scores: number[] }>();
  for (const detail of details) {
    for (const result of detail.evaluation?.criteria ?? []) {
      const group = criterionGroups.get(result.criterionId) ?? { name: result.criterionName, scores: [] };
      group.scores.push(result.normalizedScore);
      criterionGroups.set(result.criterionId, group);
    }
  }
  const scoreByDay = new Map<string, number[]>();
  for (const call of evaluated) {
    const day = call.startedAt.slice(0, 10);
    const scores = scoreByDay.get(day) ?? [];
    scores.push(call.overallScore ?? 0);
    scoreByDay.set(day, scores);
  }
  return {
    totals: {
      reviewedCalls: summary.evaluatedCalls,
      averageScore: summary.averageScore,
      passRate: evaluated.length ? evaluated.filter((call) => (call.overallScore ?? 0) >= 85).length / evaluated.length * 100 : 0,
      needsAttention: evaluated.filter((call) => (call.overallScore ?? 0) < 70).length + summary.failedCalls,
    },
    scoreTrend: [...scoreByDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, scores]) => ({
      id: day,
      label: new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)),
      score: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    })),
    criterionPerformance: [...criterionGroups].map(([criterionId, group]) => ({
      criterionId,
      name: group.name,
      average: group.scores.reduce((sum, score) => sum + score, 0) / group.scores.length,
      target: 85,
    })),
    recentCalls: [...calls].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 5),
  };
}

export const api = {
  dashboard,
  calls: () => request<CallSummary[]>("/calls"),
  call: (id: string) => request<CallDetail>(`/calls/${encodeURIComponent(id)}`),
  criteria: () => request<Criterion[]>("/criteria"),
  saveCriteria: (criteria: Criterion[]) => Promise.all(criteria.map((criterion) =>
    request<Criterion>(`/criteria/${encodeURIComponent(criterion.id)}`, {
      method: "PUT",
      body: JSON.stringify({ name: criterion.name, description: criterion.description, weight: criterion.weight, levels: criterion.levels, enabled: criterion.enabled }),
    }),
  )),
  startBatch: () => request<Run>("/runs", { method: "POST", body: JSON.stringify({}) }).then(toBatchJob),
  batch: (id: string) => request<RunDetail>(`/runs/${encodeURIComponent(id)}`).then(toBatchJob),
  latestBatch: () => request<DashboardResponse>("/dashboard").then((dashboard) => dashboard.latestRun ? toBatchJob(dashboard.latestRun) : null),
  createLive: (callId: string, pacing?: LivePacing) => request<LiveSessionDetail>("/live", { method: "POST", body: JSON.stringify({ callId, ...pacing }) }),
  live: (id: string) => request<LiveSessionDetail>(`/live/${encodeURIComponent(id)}`),
  controlLive: (id: string, action: "start" | "pause" | "reset" | "pace", pacing?: LivePacing) => request<LiveSessionDetail>(`/live/${encodeURIComponent(id)}/control`, { method: "POST", body: JSON.stringify({ action, ...pacing }) }),
};
