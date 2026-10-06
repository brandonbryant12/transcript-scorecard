import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  CircleDot,
  Gauge,
  HeartPulse,
  LoaderCircle,
  MessageSquareQuote,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
  Zap,
} from "lucide-react";
import {
  DEFAULT_REVEAL_INTERVAL_MS,
  DEFAULT_SCORE_EVERY_TURNS,
  EMOTION_LABELS,
  REVEAL_INTERVAL_OPTIONS,
  SCORE_EVERY_TURNS_OPTIONS,
  type CallSignals,
  type ScoringProvider,
  PROVIDER_LABELS,
  DEFAULT_SCORING_PROVIDER,
  providerPricing,
} from "@scorecard/domain";
import { ProviderPicker } from "./ProviderPicker";
import { api, type CallSummary, type Criterion, type LivePacing, type LiveSessionDetail } from "./api";

function timecode(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
}

function scoreColor(score: number) {
  return score >= 85 ? "#1b8a77" : score >= 70 ? "#d18a31" : "#c25b56";
}

const sessionStorageKey = "acme-live-session-ids-v2";
const sessionKey = (callId: string, provider: ScoringProvider) => `${provider}:${callId}`;

function readSessionIds(): Record<string, string> {
  try {
    const saved = localStorage.getItem(sessionStorageKey);
    const value: unknown = JSON.parse(saved ?? localStorage.getItem("acme-live-session-ids-v1") ?? "{}");
    const entries = value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string") : [];
    const ids = Object.fromEntries(saved === null ? entries.map(([callId, id]) => [sessionKey(callId, "jev"), id]) : entries);
    if (saved === null) localStorage.setItem(sessionStorageKey, JSON.stringify(ids));
    return ids;
  } catch { return {}; }
}

function rememberSession(callId: string, provider: ScoringProvider, sessionId: string | null) {
  const ids = readSessionIds();
  if (sessionId) ids[sessionKey(callId, provider)] = sessionId;
  else delete ids[sessionKey(callId, provider)];
  localStorage.setItem(sessionStorageKey, JSON.stringify(ids));
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="sparkline-empty">Waiting for another snapshot</div>;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${38 - value * .34}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 42" preserveAspectRatio="none" aria-label="Score history"><polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function StudioBlank({ message }: { message: string }) {
  return <div className="studio-blank"><Sparkles size={24} /><strong>Ready to listen</strong><p>{message}</p></div>;
}

function formatCost(value: number | null) {
  if (value === null) return "Unavailable";
  return `$${value.toFixed(value < .0001 ? 8 : 6)}`;
}

const EMOTION_COLORS: Record<string, string> = {
  frustrated: "#b6504c",
  anxious: "#bb792d",
  skeptical: "#7b6ca6",
  cooperative: "#2f8fa8",
  reassured: "#147b70",
  neutral: "#8a9799",
};

const emotionColor = (label: string) => EMOTION_COLORS[label] ?? EMOTION_COLORS.neutral!;

const formatProbability = (value: number) => value.toFixed(4).replace(/\.?0+$/, "") || "0";

function SignalsPanel({ session }: { session: LiveSessionDetail | null }) {
  const signals: CallSignals | null = session?.evaluation?.signals ?? null;
  // Dominant emotion per snapshot, so the drift across the call is visible at a glance.
  const drift = (session?.snapshots ?? []).flatMap((snapshot) =>
    snapshot.signals ? [{ sequence: snapshot.sequence, turnCount: snapshot.turnCount, label: snapshot.signals.emotion.label }] : [],
  );
  const ranked = signals
    ? [...EMOTION_LABELS].map((label) => [label, signals.emotion.probabilities[label] ?? 0] as const).sort((a, b) => b[1] - a[1])
    : [];
  const restated = signals?.restatedProblem ?? null;

  return <article className="panel signals-panel">
    <div className="signals-head">
      <span><HeartPulse size={15} />Customer signals</span>
      <small>Raw provider probabilities · excluded from the weighted score</small>
    </div>
    {signals ? <>
      <div className="emotion-headline">
        <strong style={{ color: emotionColor(signals.emotion.label) }}>{signals.emotion.label}</strong>
        <span>confidence <b>{formatProbability(signals.emotion.confidence)}</b></span>
      </div>
      <div className="signal-kind" title="A choice question picks one label from a fixed set and returns a probability for every label.">choice · emotion · P per label</div>
      <div className="emotion-bars">
        {ranked.map(([label, probability]) => <div key={label} className={label === signals.emotion.label ? "active" : ""}>
          <span>{label}</span>
          <div><i style={{ width: `${Math.max(probability * 100, 1)}%`, background: emotionColor(label) }} /></div>
          <b>{formatProbability(probability)}</b>
        </div>)}
      </div>
      {drift.length > 1 ? <div className="emotion-drift" aria-label="Dominant customer emotion across scored snapshots">
        {drift.map((point) => <i
          key={point.sequence}
          style={{ background: emotionColor(point.label) }}
          title={`Turn ${point.turnCount} · ${point.label}`}
        />)}
      </div> : null}
      <div className="signal-kind noul-kind" title="Probability that the employee restated the problem.">Yes / no · P(yes)</div>
      <div className="noul-signal">
        <span><MessageSquareQuote size={13} />Restated the problem</span>
        <div><i style={{ width: `${Math.max((restated ?? 0) * 100, 1)}%` }} /></div>
        <b>{formatProbability(restated ?? 0)}</b>
      </div>
    </> : <p className="signals-empty">Emotion and restatement signals appear with the first scored snapshot.</p>}
  </article>;
}

function TelemetryPanel({ session, provider }: { session: LiveSessionDetail | null; provider: ScoringProvider }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session?.requestStartedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [session?.requestStartedAt]);

  const pricing = session?.pricing ?? providerPricing(provider);
  const completed = session?.snapshots.slice(-6) ?? [];
  const latencies = session?.snapshots.map((snapshot) => snapshot.latencyMs) ?? [];
  const average = latencies.length ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length : null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] : null;
  const last = session?.processingLatencyMs ?? completed.at(-1)?.latencyMs ?? null;
  const running = session?.requestStartedAt ? Math.max(0, now - Date.parse(session.requestStartedAt)) : null;
  const latestSnapshot = completed.at(-1) ?? null;
  const latestCost = latestSnapshot?.estimatedCostUsd ?? null;
  const totalCost = session?.costCoverage === "none" ? null : session?.totalEstimatedCostUsd ?? null;
  const coverageLabel = !session ? "Awaiting first request" : session.costCoverage === "partial" ? "Partial usage coverage" : session.costCoverage === "none" ? "Usage unavailable" : "Complete usage coverage";

  return <article className={`panel telemetry-panel ${running !== null ? "in-flight" : ""}`}>
    <div className="telemetry-heading"><span><Zap size={14} />Every {PROVIDER_LABELS[provider]} API call</span><a href={pricing.sourceUrl} target="_blank" rel="noreferrer" title="Open provider pricing source">Estimated at ${pricing.inputUsdPerMillion}/M input · output free</a></div>
    <div className="telemetry-summary">
      <div><small>{running !== null ? `Request #${session?.requestIndex} elapsed` : "Latest latency"}</small><strong>{running === null && last === null ? "—" : Math.round(running ?? last ?? 0)}{running !== null || last !== null ? <i>ms</i> : null}</strong><span>{running !== null ? "Live server-anchored timer" : last === null ? "Awaiting provider" : session?.status === "failed" ? "Failed provider call" : "Provider round trip"}</span></div>
      <div><small>Latest est. cost</small><strong className="cost-value">{formatCost(latestCost)}</strong><span>{latestSnapshot?.inputTokens === null || !latestSnapshot ? "Usage unavailable" : `${latestSnapshot.inputTokens.toLocaleString()} input · ${(latestSnapshot.outputTokens ?? 0).toLocaleString()} output`}</span></div>
      <div><small>Session est. total</small><strong className="cost-value">{formatCost(totalCost)}</strong><span>{coverageLabel}</span></div>
    </div>
    <div className="request-history" aria-label="Recent provider request latency, tokens, and estimated cost">
      {completed.map((snapshot) => <div key={snapshot.sequence}><span>#{snapshot.sequence}</span><strong>{snapshot.latencyMs}ms</strong><i>{snapshot.inputTokens === null ? "Tokens unavailable" : `${snapshot.inputTokens.toLocaleString()} in · ${(snapshot.outputTokens ?? 0).toLocaleString()} out`}</i><b>{formatCost(snapshot.estimatedCostUsd)}</b></div>)}
      {running !== null ? <div className="active"><span>#{session?.requestIndex}</span><strong>{Math.round(running)}ms</strong><i>Provider request in flight</i><b>Pending usage</b></div> : null}
      {!completed.length && running === null ? <p>No provider requests yet. Actual token usage and estimated cost will appear here.</p> : null}
    </div>
    <div className="telemetry-stats"><span>Latency avg <b>{average === null ? "—" : `${Math.round(average)}ms`}</b></span><span title="95th percentile: all but the slowest 5% of calls came back faster than this.">P95 <b>{p95 === null ? "—" : `${Math.round(p95)}ms`}</b></span><span>Session tokens <b>{session ? `${session.totalInputTokens.toLocaleString()} in · ${session.totalOutputTokens.toLocaleString()} out` : "—"}</b></span><span title="Timings are measured on the server around the provider call, so browser polling delay is not counted.">Polling excluded</span></div>
  </article>;
}

export function LiveStudio() {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [provider, setProvider] = useState<ScoringProvider>(DEFAULT_SCORING_PROVIDER);
  const [comparison, setComparison] = useState<LiveSessionDetail | null>(null);
  const [session, setSession] = useState<LiveSessionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [paceMs, setPaceMs] = useState<number>(DEFAULT_REVEAL_INTERVAL_MS);
  const [scoreEvery, setScoreEvery] = useState<number>(DEFAULT_SCORE_EVERY_TURNS);
  const [error, setError] = useState<string | null>(null);
  const transcriptStream = useRef<HTMLDivElement>(null);
  const selectionRequest = useRef(0);

  useEffect(() => {
    let current = true;
    Promise.all([api.calls(), api.criteria()]).then(async ([items, scorecard]) => {
      if (!current) return;
      setCalls(items);
      setCriteria(scorecard.filter((criterion) => criterion.enabled));
      const firstId = items[0]?.id ?? "";
      setSelectedId(firstId);
    }).catch((reason: Error) => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    const request = ++selectionRequest.current;
    setSession(null);
    setError(null);
    const saved = readSessionIds()[sessionKey(selectedId, provider)];
    if (saved) void api.live(saved).then((restored) => {
      if (request === selectionRequest.current && restored.provider === provider) setSession(restored);
    }).catch(() => rememberSession(selectedId, provider, null));
    return () => { selectionRequest.current += 1; };
  }, [selectedId, provider]);

  useEffect(() => {
    let active = true;
    setComparison(null);
    const otherProvider = provider === "openai" ? "jev" : "openai";
    const saved = readSessionIds()[sessionKey(selectedId, otherProvider)];
    if (saved) void api.live(saved).then((other) => { if (active) setComparison(other); }).catch(() => {});
    return () => { active = false; };
  }, [selectedId, provider, session?.snapshots.length]);

  useEffect(() => {
    if (!session || busy || session.status === "completed" || session.status === "failed" || session.status === "ready" || (session.status === "paused" && !session.isProcessing)) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await api.live(session.id);
        if (active) setSession(next);
      } catch (reason) {
        if (active) setError((reason as Error).message);
      } finally {
        if (active) timer = window.setTimeout(poll, 500);
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [session?.id, session?.status, session?.isProcessing, busy]);

  useEffect(() => {
    const stream = transcriptStream.current;
    if (stream) stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
  }, [session?.revealedTurnCount]);

  const selectedCall = calls?.find((call) => call.id === selectedId) ?? null;
  const previousSnapshot = session && session.snapshots.length > 1 ? session.snapshots[session.snapshots.length - 2] : null;
  const currentScore = session?.evaluation?.overallScore ?? null;
  const previousScore = previousSnapshot?.overallScore ?? null;
  const scoreDelta = currentScore !== null && previousScore !== null ? currentScore - previousScore : null;

  const formula = useMemo(() => {
    const results = session?.evaluation?.criteria ?? [];
    const terms = criteria.map((criterion) => {
      const result = results.find((item) => item.criterionId === criterion.id);
      return { name: criterion.name, weight: criterion.weight, score: result?.normalizedScore ?? null };
    });
    const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    return {
      totalWeight,
      terms,
    };
  }, [criteria, session?.evaluation]);

  const control = async (action: "start" | "pause" | "reset") => {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      let target = session;
      if (!target || target.callId !== selectedId || target.provider !== provider) {
        target = await api.createLive(selectedId, { intervalMs: paceMs, scoreEveryTurns: scoreEvery }, provider);
        rememberSession(selectedId, provider, target.id);
      }
      if (action === "start" && (target.status === "completed" || target.status === "failed")) {
        target = await api.controlLive(target.id, "reset");
      }
      const updated = await api.controlLive(target.id, action, action === "start" ? { intervalMs: paceMs, scoreEveryTurns: scoreEvery } : undefined);
      setSession(updated);
      rememberSession(selectedId, provider, updated.id);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // A restored or newly loaded session owns the pacing; a local choice persists until then.
  useEffect(() => {
    if (!session) return;
    setPaceMs(session.revealIntervalMs);
    setScoreEvery(session.scoreEveryTurns);
  }, [session?.id]);

  const changePacing = async (pacing: LivePacing) => {
    if (pacing.intervalMs !== undefined) setPaceMs(pacing.intervalMs);
    if (pacing.scoreEveryTurns !== undefined) setScoreEvery(pacing.scoreEveryTurns);
    if (!session) return;
    const request = selectionRequest.current;
    try {
      const updated = await api.controlLive(session.id, "pace", pacing);
      if (request === selectionRequest.current) setSession(updated);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const selectTarget = async (callId: string, nextProvider: ScoringProvider) => {
    if (busy || (callId === selectedId && nextProvider === provider)) return;
    setBusy(true);
    try {
      // Pause the old provider before switching so hidden sessions do not spend usage.
      if (session?.status === "playing") await api.controlLive(session.id, "pause");
      selectionRequest.current += 1;
      setSession(null);
      setSelectedId(callId);
      setProvider(nextProvider);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };


  const statusLabel = !session ? "Ready" : session.status === "playing" && session.isProcessing ? "Live · scoring" : session.status.replace(/^./, (letter) => letter.toUpperCase());
  const isPlaying = session?.status === "playing";
  const progress = session?.totalTurns ? session.revealedTurnCount / session.totalTurns * 100 : 0;
  const conversationDuration = selectedCall ? timecode(selectedCall.durationSeconds) : null;
  // A session may carry a pacing value the option lists do not contain (set directly via
  // the API); fold it in so the select shows the truth instead of silently snapping.
  const withCurrent = (options: ReadonlyArray<number>, current: number) =>
    [...new Set([...options, current])].sort((a, b) => a - b);
  const paceOptions = withCurrent(REVEAL_INTERVAL_OPTIONS, paceMs);
  const scoreEveryOptions = withCurrent(SCORE_EVERY_TURNS_OPTIONS, scoreEvery);
  const paceSeconds = paceMs / 1000;
  const replayTurns = session?.totalTurns ?? null;
  const projectedReplay = replayTurns === null ? null : timecode(replayTurns * paceSeconds);
  const projectedRequests = replayTurns === null ? null : Math.max(1, Math.ceil(replayTurns / scoreEvery));

  return <>
    <header className="page-header studio-header">
      <div><p className="eyebrow">ACME support · fictional demo</p><h1>Live scoring studio</h1><p>Watch QA scores move as each transcript turn reaches the model.</p></div>
      <div className={`live-status live-${session?.status ?? "ready"}`}><span />{statusLabel}</div>
    </header>
    <ol className="studio-steps" aria-label="How this demo works">
      <li><b>1</b><span><strong>A real transcript replays</strong>One turn at a time, left</span></li>
      <li><b>2</b><span><strong>Batches go to {PROVIDER_LABELS[provider]}</strong>The call so far, scored against the rubric</span></li>
      <li><b>3</b><span><strong>Everything updates live</strong>Score, signals, latency and cost</span></li>
    </ol>
    <ProviderPicker provider={provider} onChange={(value) => { void selectTarget(selectedId, value); }} disabled={busy} />
    <section className="studio-controls panel">
      <label className="call-picker"><span>Replay a support call</span><div><select value={selectedId} onChange={(event) => selectTarget(event.target.value, provider)} disabled={!calls?.length || busy}>{calls?.map((call) => <option value={call.id} key={call.id}>{call.subject} · {call.customerName} · {call.agentName}</option>)}</select><ChevronDown size={16} /></div><small>{conversationDuration ? `${conversationDuration} conversation · accelerated replay` : "Loading conversation…"}</small></label>
      <label className="call-picker pace-picker">
        <span>Turn pace</span>
        <div>
          <select value={paceMs} onChange={(event) => changePacing({ intervalMs: Number(event.target.value) })} disabled={busy}>
            {paceOptions.map((option) => <option value={option} key={option}>{option / 1000}s per turn</option>)}
          </select>
          <ChevronDown size={16} />
        </div>
        <small>{projectedReplay ? `${replayTurns} turns in ~${projectedReplay}` : "How fast transcript turns appear"}</small>
      </label>
      <label className="call-picker pace-picker">
        <span>Rescore every</span>
        <div>
          <select value={scoreEvery} onChange={(event) => changePacing({ scoreEveryTurns: Number(event.target.value) })} disabled={busy}>
            {scoreEveryOptions.map((option) => <option value={option} key={option}>{option === 1 ? "every turn" : `${option} turns`}</option>)}
          </select>
          <ChevronDown size={16} />
        </div>
        <small>{projectedRequests === null ? "Turns batched per API call" : scoreEvery === 1 ? `~${projectedRequests} API calls` : `~${projectedRequests} API calls, not ${replayTurns}`}</small>
      </label>
      <div className="playback-controls">
        <button className="studio-button primary" disabled={!selectedId || busy || isPlaying} onClick={() => control("start")}>{busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{session?.status === "paused" ? "Resume" : session?.status === "completed" ? "Replay" : "Start replay"}</button>
        <button className="studio-button" disabled={!session || !isPlaying || busy} onClick={() => control("pause")}><Pause size={15} />Pause</button>
        <button className="studio-button icon-only" disabled={!session || busy} onClick={() => control("reset")} aria-label="Reset replay"><RotateCcw size={16} /></button>
      </div>
      <div className="replay-progress"><div><span style={{ width: `${progress}%` }} /></div><small>{session ? `${session.revealedTurnCount} / ${session.totalTurns} turns · ${timecode(session.elapsedMs / 1000)} replay elapsed` : "Replay not started"}</small></div>
    </section>
    {error ? <div className="inline-error studio-error"><AlertCircle size={16} />{error}</div> : null}
    <ProviderComparison session={session} other={comparison} />
    <section className="studio-grid">
      <article className="panel transcript-panel">
        <div className="studio-panel-head"><div><p className="eyebrow">Transcript stream</p><h2>{selectedCall?.subject ?? "Loading calls…"}</h2></div>{session ? <span className="clock"><Timer size={13} />{(session.elapsedMs / 1000).toFixed(1)}s</span> : null}</div>
        <div className="transcript-stream" ref={transcriptStream}>
          {session?.transcript.length ? session.transcript.map((turn, index) => <div className={`live-turn ${turn.speaker}`} key={`${session.generation}-${turn.id}`}><div className="live-speaker"><span>{turn.speaker === "employee" ? selectedCall?.agentName : selectedCall?.customerName}</span><time>{timecode(turn.startSeconds)}</time></div><p>{turn.text}</p>{index === session.transcript.length - 1 && isPlaying ? <i className="speaking-dot"><span /><span /><span /></i> : null}</div>) : <StudioBlank message={`Choose a call and press start. Turns appear here every ${paceSeconds}s, and the call so far is scored every ${scoreEvery === 1 ? "turn" : `${scoreEvery} turns`}.`} />}
        </div>
        <footer className="stream-footer"><span><CircleDot size={13} />{session ? `${session.scoredTurnCount} of ${session.totalTurns} turns scored · ${session.pendingTurnCount} waiting` : "Awaiting replay"}</span><span>{session?.isProcessing ? <><LoaderCircle className="spin" size={13} />Model request in flight</> : session?.processingLatencyMs !== null && session ? <><Zap size={13} />Last result {session.processingLatencyMs}ms</> : "No model request yet"}</span></footer>
      </article>
      <div className="scoring-column">
        <article className={`panel live-score-card ${session?.isProcessing ? "processing" : ""}`}>
          <div className="score-orbit"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="51"/><circle className="score-progress" cx="60" cy="60" r="51" style={{ strokeDashoffset: 320 - 3.2 * (currentScore ?? 0), stroke: currentScore === null ? "#96aaa6" : scoreColor(currentScore) }} /></svg><div><strong>{currentScore === null ? "—" : Math.round(currentScore)}</strong><span>{session?.status === "completed" ? "final score" : "live score"}</span></div></div>
          <div className="score-copy"><p className="eyebrow">Weighted QA score</p><h2>{session?.status === "completed" ? "Final result" : session?.isProcessing ? "Recalculating…" : currentScore === null ? "Awaiting first score" : "Latest snapshot"}</h2>{scoreDelta !== null ? <span className={`score-delta ${scoreDelta >= 0 ? "positive" : "negative"}`}>{scoreDelta >= 0 ? "+" : ""}{scoreDelta.toFixed(1)} since last snapshot</span> : <span className="score-delta neutral">Delta appears after the next snapshot</span>}</div>
          {session?.isProcessing ? <span className="processing-sheen" /> : null}
        </article>
        <div className="studio-insights">
          <article className="panel formula-card"><div className="formula-head"><span><Gauge size={15} />How the score is built</span><small title="Each criterion's score is multiplied by its weight; the total is divided by the sum of the weights.">Σ(weight × score) ÷ Σweight</small></div>{formula.terms.length ? <div className="formula-expression"><b>(</b>{formula.terms.map((term, index) => <span key={term.name}>{index > 0 ? <b>+</b> : null}<i>{term.weight} × {term.score === null ? "—" : term.score.toFixed(1)}</i></span>)}<b>) ÷ {formula.totalWeight}</b><strong>= {currentScore === null ? "—" : currentScore.toFixed(1)}</strong></div> : <p>Loading the active scorecard…</p>}</article>
          <TelemetryPanel session={session} provider={provider} />
        </div>
        <SignalsPanel session={session} />
        <div className="live-criteria">
          {criteria.length ? criteria.map((configured) => {
            const criterion = session?.evaluation?.criteria.find((result) => result.criterionId === configured.id);
            if (!criterion) return <article className="panel live-criterion empty" key={configured.id}><div className="criterion-live-head"><div><span className="criterion-kicker">{configured.weight}% weight</span><h3>{configured.name}</h3></div><div className="criterion-score"><strong>—</strong></div></div><p className="criterion-description">{configured.description}</p><details className="rubric-details"><summary>Rubric levels</summary><div className="rubric-levels">{configured.levels.map((level, index) => <span key={level}>{index} · {level}</span>)}</div></details><div className="confidence"><span>Confidence</span><div /><strong>—</strong></div><p className="waiting-evidence">Waiting for scored transcript evidence…</p></article>;
            const history = session!.snapshots.map((snapshot) => snapshot.criteria.find((item) => item.criterionId === criterion.criterionId)?.normalizedScore).filter((score): score is number => score !== undefined);
            const prior = previousSnapshot?.criteria.find((item) => item.criterionId === criterion.criterionId)?.normalizedScore;
            const delta = prior === undefined ? null : criterion.normalizedScore - prior;
            return <article className="panel live-criterion" key={criterion.criterionId}><div className="criterion-live-head"><div><span className="criterion-kicker">{criterion.weight}% weight</span><h3>{criterion.criterionName}</h3></div><div className="criterion-score"><strong style={{ color: scoreColor(criterion.normalizedScore) }}>{Math.round(criterion.normalizedScore)}</strong>{delta !== null ? <small className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "+" : ""}{delta.toFixed(0)}</small> : null}</div></div><p className="criterion-description">{criterion.criterionDescription}</p><details className="rubric-details"><summary>Rubric levels</summary><div className="rubric-levels">{criterion.levels.map((level, index) => <span key={level}>{index} · {level}</span>)}</div></details><Sparkline values={history} color={scoreColor(criterion.normalizedScore)} /><div className="confidence"><span>Confidence</span><div><i style={{ width: `${criterion.confidence * 100}%` }} /></div><strong>{Math.round(criterion.confidence * 100)}%</strong></div>{criterion.evidence ? <blockquote>“{criterion.evidence.text}”</blockquote> : <p className="waiting-evidence">Waiting for a supporting turn…</p>}</article>;
          }) : <div className="panel criterion-wait"><Activity size={20} /><span>Criteria will update here as the provider returns scored transcript snapshots.</span></div>}
        </div>
        {session?.status === "completed" ? <div className="completion-banner"><Check size={17} /><span><strong>Replay complete</strong>Final score uses the full transcript.</span></div> : null}
      </div>
    </section>
  </>;
}

function ProviderComparison({ session, other }: { session: LiveSessionDetail | null; other: LiveSessionDetail | null }) {
  const latest = session?.snapshots.at(-1);
  const matched = other?.snapshots.find((snapshot) => snapshot.turnCount === latest?.turnCount);
  const rubric = (criteria: NonNullable<typeof latest>["criteria"]) => JSON.stringify(criteria.map(({ criterionId, criterionName, criterionDescription, weight, levels }) => ({ criterionId, criterionName, criterionDescription, weight, levels })));
  const comparable = latest && matched && rubric(latest.criteria) === rubric(matched.criteria);
  return <section className="panel provider-comparison" aria-label="Provider comparison">
    <div><h2>Compare providers</h2><p>{comparable ? `Same transcript prefix: ${latest.turnCount} turns · same rubric` : "Replay this call with both providers. Scores align when the transcript prefix and rubric match."}</p></div>
    {comparable && session && other ? <div className="comparison-scroll"><table>
      <thead><tr><th scope="col">Measure</th><th scope="col">{PROVIDER_LABELS[session.provider]}</th><th scope="col">{PROVIDER_LABELS[other.provider]}</th></tr></thead>
      <tbody>
        <tr><th scope="row">Model</th><td>{latest.model}</td><td>{matched.model}</td></tr>
        <tr><th scope="row">Weighted score</th><td>{latest.overallScore.toFixed(1)}</td><td>{matched.overallScore.toFixed(1)}</td></tr>
        <tr><th scope="row">Request latency</th><td>{latest.latencyMs}ms</td><td>{matched.latencyMs}ms</td></tr>
        <tr><th scope="row">Estimated request cost</th><td>{formatCost(latest.estimatedCostUsd)}</td><td>{formatCost(matched.estimatedCostUsd)}</td></tr>
        {latest.criteria.map((criterion) => { const result = matched.criteria.find((item) => item.criterionId === criterion.criterionId)!;
          return <tr key={criterion.criterionId}><th scope="row">{criterion.criterionName}</th><td>{criterion.normalizedScore.toFixed(1)} · {(criterion.confidence * 100).toFixed(0)}% confidence</td><td>{result.normalizedScore.toFixed(1)} · {(result.confidence * 100).toFixed(0)}% confidence</td></tr>; })}
      </tbody>
    </table></div> : null}
    {session?.error ? <p className="inline-error">{PROVIDER_LABELS[session.provider]}: {session.error}</p> : null}
  </section>;
}
