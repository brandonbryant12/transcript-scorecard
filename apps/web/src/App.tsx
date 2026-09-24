import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  FileAudio,
  Gauge,
  Headphones,
  Inbox,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Play,
  Radio,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { LiveStudio } from "./LiveStudio";
import {
  api,
  type BatchJob,
  type CallDetail,
  type CallStatus,
  type CallSummary,
  type DashboardData,
  type Criterion,
} from "./api";

type View = "live" | "overview" | "calls" | "scorecard" | "batch";

const navItems: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: "live", label: "Live studio", icon: Radio },
  { view: "overview", label: "Analytics", icon: LayoutDashboard },
  { view: "calls", label: "Call library", icon: Headphones },
  { view: "scorecard", label: "Scorecard", icon: Settings2 },
  { view: "batch", label: "Batch review", icon: Sparkles },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
}

function formatOffset(seconds: number) {
  return formatDuration(seconds);
}

function formatUsd(value: number | null) {
  if (value === null) return "—";
  return `$${value.toFixed(value !== 0 && value < .0001 ? 8 : 6)}`;
}

function scoreTone(score: number | null) {
  if (score === null) return "neutral";
  if (score >= 85) return "good";
  if (score >= 70) return "warn";
  return "bad";
}

function StatusPill({ status }: { status: CallStatus }) {
  const labels: Record<CallStatus, string> = { pending: "Pending", processing: "Reviewing", completed: "Reviewed", failed: "Failed" };
  return <span className={`status status-${status}`}><span />{labels[status]}</span>;
}

function LoadingState({ label = "Loading workspace" }: { label?: string }) {
  return <div className="state-card"><LoaderCircle className="spin" size={22} /><strong>{label}</strong><span>Fetching the latest review data…</span></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="state-card error"><AlertCircle size={23} /><strong>We couldn’t load this view</strong><span>{message}</span><button className="button secondary" onClick={onRetry}><RefreshCw size={15} />Try again</button></div>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="state-card"><Inbox size={24} /><strong>{title}</strong><span>{copy}</span></div>;
}

function ScoreRing({ value, size = "large" }: { value: number; size?: "large" | "small" }) {
  return (
    <div className={`score-ring ${size}`} style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties}>
      <div><strong>{Math.round(value)}</strong>{size === "large" ? <span>/ 100</span> : null}</div>
    </div>
  );
}

function TrendChart({ points }: { points: DashboardData["scoreTrend"] }) {
  if (!points.length) return <EmptyState title="No trend yet" copy="Scores appear after calls are reviewed." />;
  const width = 620;
  const height = 180;
  const coords = points.map((point, index) => ({
    x: 12 + (index * (width - 24)) / Math.max(points.length - 1, 1),
    y: height - 12 - (point.score / 100) * (height - 24),
  }));
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `12,${height - 10} ${line} ${width - 12},${height - 10}`;
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Average QA score trend">
        <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d8c80" stopOpacity=".22"/><stop offset="1" stopColor="#1d8c80" stopOpacity="0"/></linearGradient></defs>
        {[25, 50, 75, 100].map((tick) => <line key={tick} x1="12" x2={width - 12} y1={height - 12 - (tick / 100) * (height - 24)} y2={height - 12 - (tick / 100) * (height - 24)} className="chart-grid" />)}
        <polygon points={area} fill="url(#trendFill)" />
        <polyline points={line} fill="none" stroke="#147b70" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((point, index) => <circle key={points[index].id} cx={point.x} cy={point.y} r="4" fill="#fff" stroke="#147b70" strokeWidth="3"><title>{points[index].label}: {Math.round(points[index].score)}%</title></circle>)}
      </svg>
      <div className="chart-labels">{points.map((point) => <span key={point.id}>{point.label}</span>)}</div>
    </div>
  );
}

function CallRows({ calls, onSelect }: { calls: CallSummary[]; onSelect: (call: CallSummary) => void }) {
  if (!calls.length) return <EmptyState title="No calls found" copy="Try a different search or filter." />;
  return (
    <div className="call-table">
      <div className="table-head"><span>Call</span><span>Agent</span><span>Status</span><span>Score</span><span /></div>
      {calls.map((call) => (
        <button className="call-row" key={call.id} onClick={() => onSelect(call)}>
          <span className="call-identity"><span className="avatar">{call.customerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><span><strong>{call.customerName}</strong><small>{call.subject} · {formatDate(call.startedAt)} · {formatDuration(call.durationSeconds)}</small></span></span>
          <span>{call.agentName}</span><StatusPill status={call.status} /><span className={`score-text ${scoreTone(call.overallScore)}`}>{call.overallScore === null ? "—" : `${Math.round(call.overallScore)}%`}</span><ChevronRight size={17} />
        </button>
      ))}
    </div>
  );
}

function Overview({ onOpenCall, onViewAll, onRunBatch }: { onOpenCall: (call: CallSummary) => void; onViewAll: () => void; onRunBatch: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setError(null); api.dashboard().then(setData).catch((reason: Error) => setError(reason.message)); };
  useEffect(() => { load(); }, []);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Building your overview" />;
  const cards = [
    { label: "Reviewed calls", value: data.totals.reviewedCalls.toLocaleString(), note: "All scored conversations", icon: Headphones },
    { label: "Average score", value: data.totals.reviewedCalls ? `${Math.round(data.totals.averageScore)}%` : "—", note: "Across active criteria", icon: Gauge },
    { label: "Pass rate", value: data.totals.reviewedCalls ? `${Math.round(data.totals.passRate)}%` : "—", note: "At or above 85%", icon: Target },
    { label: "Needs attention", value: data.totals.needsAttention.toLocaleString(), note: "Below 70% or failed", icon: AlertCircle },
  ];
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Fictional demo transcripts</p><h1>Conversation review</h1><p>Explore a seeded support dataset and run the pending calls through QA.</p></div><button className="button primary" onClick={onRunBatch}><Play size={16} />Review seeded calls</button></header>
      <section className="metric-grid">{cards.map(({ label, value, note, icon: Icon }) => <article className="metric-card" key={label}><div className="metric-top"><span className="icon-tile"><Icon size={18} /></span></div><strong>{value}</strong><h3>{label}</h3><p>{note}</p></article>)}</section>
      <section className="dashboard-grid">
        <article className="panel trend-panel"><div className="panel-title"><div><p className="eyebrow">Last 30 days</p><h2>Quality trend</h2></div><span className="target-chip"><CircleDot size={14} />Target 85%</span></div><TrendChart points={data.scoreTrend} /></article>
        <article className="panel criteria-panel"><div className="panel-title"><div><p className="eyebrow">By criterion</p><h2>Performance</h2></div><BarChart3 size={19} /></div><div className="criterion-bars">{data.criterionPerformance.map((criterion) => <div key={criterion.criterionId}><div className="bar-label"><span>{criterion.name}</span><strong>{Math.round(criterion.average)}%</strong></div><div className="bar-track"><span style={{ width: `${criterion.average}%` }} /><i style={{ left: `${criterion.target}%` }} /></div></div>)}</div></article>
      </section>
      <section className="panel recent-panel"><div className="panel-title"><div><p className="eyebrow">Latest activity</p><h2>Recent reviews</h2></div><button className="text-button" onClick={onViewAll}>View all <ChevronRight size={15} /></button></div><CallRows calls={data.recentCalls} onSelect={onOpenCall} /></section>
    </>
  );
}

function Calls({ initialId, onCloseInitial }: { initialId: string | null; onCloseInitial: () => void }) {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CallStatus>("all");
  const [error, setError] = useState<string | null>(null);
  const load = () => { setError(null); api.calls().then(setCalls).catch((reason: Error) => setError(reason.message)); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    let current = true;
    setDetail(null);
    setDetailError(null);
    if (!selectedId) return () => { current = false; };
    api.call(selectedId).then((value) => { if (current) setDetail(value); }).catch((reason: Error) => { if (current) setDetailError(reason.message); });
    return () => { current = false; };
  }, [selectedId]);
  const filtered = useMemo(() => (calls ?? []).filter((call) => {
    const matchesQuery = `${call.customerName} ${call.agentName} ${call.subject}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || call.status === status);
  }), [calls, query, status]);
  const closeDetail = () => { setSelectedId(null); setDetail(null); onCloseInitial(); };
  if (error && !calls) return <ErrorState message={error} onRetry={load} />;
  if (!calls) return <LoadingState label="Loading call library" />;
  return (
    <>
      <header className="page-header compact"><div><p className="eyebrow">Fictional demo transcripts</p><h1>Call library</h1><p>Search, review, and understand every seeded interaction.</p></div></header>
      <section className="panel library-panel"><div className="toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, agent, or subject…" aria-label="Search calls" /></label><label className="filter-field"><ListFilter size={16} /><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Filter by status"><option value="all">All statuses</option><option value="completed">Reviewed</option><option value="processing">Reviewing</option><option value="pending">Pending</option><option value="failed">Failed</option></select></label><span className="result-count">{filtered.length} calls</span></div><CallRows calls={filtered} onSelect={(call) => setSelectedId(call.id)} /></section>
      {selectedId ? <CallDrawer detail={detail} error={detailError} onRetry={() => { const id = selectedId; setSelectedId(null); window.setTimeout(() => setSelectedId(id), 0); }} onClose={closeDetail} /> : null}
    </>
  );
}

function CallDrawer({ detail, error, onRetry, onClose }: { detail: CallDetail | null; error: string | null; onRetry: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<"score" | "transcript">("score");
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer" aria-label="Call review detail">
        <button className="icon-button close" onClick={onClose} aria-label="Close detail"><X size={19} /></button>
        {detail ? <>
          <div className="drawer-heading">
            <div className="avatar large">{detail.customerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
            <div><p className="eyebrow">{detail.subject}</p><h2>{detail.customerName}</h2><p>{detail.agentName} · {formatDate(detail.startedAt)} · {formatDuration(detail.durationSeconds)}</p></div>
            {detail.evaluation ? <ScoreRing value={detail.evaluation.overallScore} size="small" /> : <StatusPill status={detail.status} />}
          </div>
          <div className="tabs"><button className={tab === "score" ? "active" : ""} onClick={() => setTab("score")}>Scorecard</button><button className={tab === "transcript" ? "active" : ""} onClick={() => setTab("transcript")}>Transcript</button></div>
          {tab === "score" ? (
            detail.evaluation ? <div className="score-detail">{detail.evaluation.criteria.map((criterion) => {
              const evidenceTurn = detail.transcript.find((turn) => turn.id === criterion.evidence?.turnId);
              return <article key={criterion.criterionId} className="criterion-detail">
                <div className="criterion-line">
                  <span className={`check-icon ${criterion.normalizedScore >= 80 ? "pass" : "miss"}`}>{criterion.normalizedScore >= 80 ? <Check size={14} /> : <AlertCircle size={14} />}</span>
                  <div><h3>{criterion.criterionName}</h3><p>{Math.round(criterion.confidence * 100)}% model confidence</p></div>
                  <strong>{Math.round(criterion.normalizedScore)}%</strong>
                </div>
                <div className="distribution" aria-label={`${criterion.criterionName} score probability distribution`}>
                  {Object.entries(criterion.probabilities).map(([level, probability]) => <div key={level}><span><i>{level}</i><b>{Math.round(probability * 100)}%</b></span><div><i style={{ width: `${probability * 100}%` }} /></div></div>)}
                </div>
                {criterion.evidence ? <blockquote><span>{evidenceTurn ? formatOffset(evidenceTurn.startSeconds) : "Evidence"}</span>“{criterion.evidence.text}”</blockquote> : <p className="no-evidence">No supporting transcript turn was selected.</p>}
              </article>;
            })}</div> : <EmptyState title="Not scored yet" copy="This call will receive criterion scores after its review completes." />
          ) : <div className="transcript">{detail.transcript.map((turn) => <div key={turn.id} className={`turn ${turn.speaker}`}><div className="turn-meta"><strong>{turn.speaker === "employee" ? detail.agentName : detail.customerName}</strong><span>{formatOffset(turn.startSeconds)}</span></div><p>{turn.text}</p></div>)}</div>}
        </> : error ? <ErrorState message={error} onRetry={onRetry} /> : <LoadingState label="Loading call review" />}
      </aside>
    </div>
  );
}

function Scorecard() {
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [saved, setSaved] = useState<Criterion[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.criteria().then((value) => { setCriteria(value); setSaved(value); setError(null); }).catch((reason: Error) => setError(reason.message));
  useEffect(() => { load(); }, []);
  const changed = JSON.stringify(criteria) !== JSON.stringify(saved);
  const totalWeight = criteria?.filter((item) => item.enabled).reduce((sum, item) => sum + item.weight, 0) ?? 0;
  const update = (id: string, patch: Partial<Criterion>) => setCriteria((current) => current?.map((item) => item.id === id ? { ...item, ...patch } : item) ?? null);
  const save = async () => {
    if (!criteria || totalWeight !== 100) return;
    setSaving(true);
    setError(null);
    try {
      const value = await api.saveCriteria(criteria);
      setCriteria(value);
      setSaved(value);
    } catch (reason) {
      try {
        const canonical = await api.criteria();
        setCriteria(canonical);
        setSaved(canonical);
      } catch { /* Preserve the original save error when reload also fails. */ }
      setError(`Changes were not fully saved. Server values were reloaded. ${(reason as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  if (!criteria) return error ? <ErrorState message={error} onRetry={load} /> : <LoadingState label="Loading scorecard" />;
  return <><header className="page-header compact"><div><p className="eyebrow">Review framework</p><h1>Scorecard criteria</h1><p>Shape how every support conversation is evaluated.</p></div><button className="button primary" disabled={!changed || saving || totalWeight !== 100} onClick={save}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? "Saving…" : "Save changes"}</button></header>{error ? <div className="inline-error"><AlertCircle size={16} />{error}</div> : null}<section className="scorecard-layout"><div className="panel criteria-editor"><div className="editor-head"><span>Criterion</span><span>Weight</span><span>Active</span></div>{criteria.map((criterion, index) => <article className={`editor-row ${criterion.enabled ? "" : "disabled"}`} key={criterion.id}><span className="criterion-number">{String(index + 1).padStart(2, "0")}</span><div><input className="title-input" value={criterion.name} onChange={(event) => update(criterion.id, { name: event.target.value })} aria-label={`Criterion ${index + 1} name`} /><textarea value={criterion.description} onChange={(event) => update(criterion.id, { description: event.target.value })} aria-label={`${criterion.name} description`} /></div><label className="weight-input"><input type="number" min="0" max="100" value={criterion.weight} onChange={(event) => update(criterion.id, { weight: Number(event.target.value) })} /><span>%</span></label><label className="switch"><input type="checkbox" checked={criterion.enabled} onChange={(event) => update(criterion.id, { enabled: event.target.checked })} /><span /></label></article>)}</div><aside className="panel weight-panel"><p className="eyebrow">Weight allocation</p><div className={`weight-total ${totalWeight === 100 ? "valid" : "invalid"}`}><strong>{totalWeight}%</strong><span>of 100%</span></div><div className="weight-stack">{criteria.filter((item) => item.enabled).map((item, index) => <span key={item.id} style={{ width: `${item.weight}%`, background: ["#143f52", "#1a8077", "#55aa94", "#9bcbbb", "#e0a04e"][index % 5] }} title={`${item.name}: ${item.weight}%`} />)}</div><p>{totalWeight === 100 ? "Weights are balanced and ready to save." : `Adjust active criteria by ${Math.abs(100 - totalWeight)} points.`}</p><div className="weight-list">{criteria.filter((item) => item.enabled).map((item) => <div key={item.id}><span>{item.name}</span><strong>{item.weight}%</strong></div>)}</div></aside></section></>;
}

function BatchReview({ startImmediately = false, onStartHandled }: { startImmediately?: boolean; onStartHandled: () => void }) {
  const [job, setJob] = useState<BatchJob | null>(null);
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const initialize = async () => {
      try {
        if (startImmediately) {
          const started = await api.startBatch();
          if (current) setJob(started);
          onStartHandled();
          return;
        }
        const latest = await api.latestBatch();
        if (!current || !latest) return;
        const detail = await api.batch(latest.id);
        if (current) setJob(detail);
      } catch (reason) {
        if (current) setError((reason as Error).message);
      } finally {
        if (current) setInitializing(false);
      }
    };
    void initialize();
    return () => { current = false; };
  }, [startImmediately, onStartHandled]);
  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "queued")) return;
    const timer = window.setInterval(() => api.batch(job.id).then(setJob).catch((reason: Error) => setError(reason.message)), 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);
  // The library table reflects stored evaluations, so refresh it as the run advances.
  useEffect(() => { void api.calls().then(setCalls).catch(() => {}); }, [job?.processed, job?.status]);
  const start = async () => { setStarting(true); setError(null); try { setJob(await api.startBatch()); } catch (reason) { setError((reason as Error).message); } finally { setStarting(false); } };
  const progress = job && job.total ? Math.round((job.processed / job.total) * 100) : 0;

  const scored = (calls ?? []).filter((call) => call.overallScore !== null);
  const latencies = scored.flatMap((call) => call.latencyMs === null ? [] : [call.latencyMs]).sort((a, b) => a - b);
  const averageLatency = latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null;
  const p95Latency = latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)]! : null;
  const averageScore = scored.length ? scored.reduce((sum, call) => sum + (call.overallScore ?? 0), 0) / scored.length : null;
  const costed = scored.filter((call) => call.estimatedCostUsd !== null);
  const totalCost = costed.length ? costed.reduce((sum, call) => sum + (call.estimatedCostUsd ?? 0), 0) : null;
  const totalInput = scored.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0);
  const totalOutput = scored.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
  return <><header className="page-header compact"><div><p className="eyebrow">Automated QA</p><h1>Batch review</h1><p>Score every pending conversation against your active criteria.</p></div></header><section className="batch-grid"><article className="panel batch-hero"><span className="batch-icon"><Sparkles size={28} /></span><h2>Review pending calls</h2><p>Signal will process the current queue, attach evidence to each criterion, and preserve any errors for review.</p><button className="button primary large" onClick={start} disabled={initializing || starting || job?.status === "running" || job?.status === "queued"}>{initializing || starting ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{initializing ? "Loading run…" : starting ? "Starting…" : "Run batch review"}</button>{error ? <div className="inline-error"><AlertCircle size={16} />{error}</div> : null}</article><article className="panel batch-status"><div className="panel-title"><div><p className="eyebrow">Current run</p><h2>{job ? job.status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : initializing ? "Loading latest run" : "Ready when you are"}</h2></div>{job?.status === "completed" || job?.status === "completed_with_errors" ? <span className="complete-mark"><Check size={18} /></span> : null}</div>{job ? <><div className="progress-copy"><strong>{job.processed} of {job.total}</strong><span>{progress}% complete</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="batch-stats"><div><strong>{job.succeeded}</strong><span>Scored</span></div><div><strong>{job.failed}</strong><span>Errors</span></div><div><strong>{job.total - job.processed}</strong><span>Remaining</span></div></div>{job.errors.length ? <div className="error-list"><h3>Needs attention</h3>{job.errors.map((item) => <div key={item.callId}><AlertCircle size={15} /><span><strong>{item.callId}</strong>{item.message}</span></div>)}</div> : null}</> : initializing ? <LoadingState label="Restoring latest run" /> : <div className="batch-empty"><FileAudio size={25} /><p>No batch is running. Start a review to see real-time progress and results here.</p></div>}</article></section><section className="panel batch-results"><div className="panel-title"><div><p className="eyebrow">Call library</p><h2>Results, latency and cost</h2></div><span className="results-note">{calls ? `${scored.length} of ${calls.length} calls scored` : "Loading library…"}</span></div>{calls ? <><div className="batch-metrics"><div><strong>{averageScore === null ? "—" : averageScore.toFixed(1)}</strong><span>Average score</span></div><div><strong>{formatUsd(totalCost)}</strong><span>Total est. cost</span></div><div><strong>{totalInput ? totalInput.toLocaleString() : "—"}</strong><span>Input tokens</span></div><div><strong>{totalOutput ? totalOutput.toLocaleString() : "—"}</strong><span>Output tokens</span></div><div><strong>{averageLatency === null ? "—" : `${averageLatency}ms`}</strong><span>Average latency</span></div><div><strong>{p95Latency === null ? "—" : `${p95Latency}ms`}</strong><span>P95 latency</span></div></div><div className="results-table"><div className="results-head"><span>Call</span><span>Status</span><span>Score</span><span>Latency</span><span>Tokens</span><span>Est. cost</span></div>{calls.map((call) => <div className="results-row" key={call.id}><span className="results-call"><strong>{call.subject}</strong><small>{call.customerName} · {call.agentName}</small></span><StatusPill status={call.status} /><span className={`score-text ${scoreTone(call.overallScore)}`}>{call.overallScore === null ? "—" : call.overallScore.toFixed(1)}</span><span className="results-number">{call.latencyMs === null ? "—" : `${call.latencyMs}ms`}</span><span className="results-number">{call.inputTokens === null ? "—" : `${call.inputTokens.toLocaleString()} in · ${(call.outputTokens ?? 0).toLocaleString()} out`}</span><span className="results-number">{formatUsd(call.estimatedCostUsd)}</span></div>)}</div>{latencies.length < scored.length ? <p className="results-footnote">Latency is recorded from this release onward, so evaluations stored earlier show no timing.</p> : null}</> : <LoadingState label="Loading call library" />}</section></>;
}

export function App() {
  const [view, setView] = useState<View>("live");
  const [selectedCall, setSelectedCall] = useState<string | null>(null);
  const [startBatchOnOpen, setStartBatchOnOpen] = useState(false);
  const openCall = (call: CallSummary) => { setSelectedCall(call.id); setView("calls"); };
  const handleStartHandled = useCallback(() => setStartBatchOnOpen(false), []);
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><span /><span /><span /></span><span><strong>ACME Signal</strong><small>Support quality lab</small></span></div><nav aria-label="Primary navigation">{navItems.map(({ view: itemView, label, icon: Icon }) => <button key={itemView} aria-label={label} title={label} className={view === itemView ? "active" : ""} onClick={() => { setStartBatchOnOpen(false); setView(itemView); }}><Icon size={18} /><span>{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="team-card"><CircleDot size={17} /><span><strong>Seeded demo</strong><small>Fictional transcripts · SQLite</small></span></div></div></aside><main className="main-content">{view === "live" ? <LiveStudio /> : null}{view === "overview" ? <Overview onOpenCall={openCall} onViewAll={() => setView("calls")} onRunBatch={() => { setStartBatchOnOpen(true); setView("batch"); }} /> : null}{view === "calls" ? <Calls initialId={selectedCall} onCloseInitial={() => setSelectedCall(null)} /> : null}{view === "scorecard" ? <Scorecard /> : null}{view === "batch" ? <BatchReview startImmediately={startBatchOnOpen} onStartHandled={handleStartHandled} /> : null}</main></div>;
}
