import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  CircleDot,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
  Zap,
} from "lucide-react";
import { api, type CallSummary, type Criterion, type LiveSessionDetail } from "./api";

function timecode(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
}

function scoreColor(score: number) {
  return score >= 85 ? "#1b8a77" : score >= 70 ? "#d18a31" : "#c25b56";
}

const sessionStorageKey = "acme-live-session-ids-v1";

function readSessionIds(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) ?? "{}") as Record<string, string>; }
  catch { return {}; }
}

function rememberSession(callId: string, sessionId: string | null) {
  const ids = readSessionIds();
  if (sessionId) ids[callId] = sessionId;
  else delete ids[callId];
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

export function LiveStudio() {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [session, setSession] = useState<LiveSessionDetail | null>(null);
  const [busy, setBusy] = useState(false);
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
      const savedSessionId = readSessionIds()[firstId];
      if (savedSessionId) {
        const request = ++selectionRequest.current;
        try {
          const restored = await api.live(savedSessionId);
          if (current && request === selectionRequest.current) setSession(restored);
        } catch { rememberSession(firstId, null); }
      }
    }).catch((reason: Error) => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, []);

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
      if (!target || target.callId !== selectedId) {
        target = await api.createLive(selectedId);
        rememberSession(selectedId, target.id);
      }
      if (action === "start" && (target.status === "completed" || target.status === "failed")) {
        target = await api.controlLive(target.id, "reset");
      }
      const updated = await api.controlLive(target.id, action);
      setSession(updated);
      rememberSession(selectedId, action === "reset" ? null : updated.id);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectCall = (callId: string) => {
    const request = ++selectionRequest.current;
    setSelectedId(callId);
    setSession(null);
    setError(null);
    const savedSessionId = readSessionIds()[callId];
    if (savedSessionId) api.live(savedSessionId).then((restored) => { if (request === selectionRequest.current) setSession(restored); }).catch(() => rememberSession(callId, null));
  };

  const statusLabel = !session ? "Ready" : session.status === "playing" && session.isProcessing ? "Live · scoring" : session.status.replace(/^./, (letter) => letter.toUpperCase());
  const isPlaying = session?.status === "playing";
  const progress = session?.totalTurns ? session.revealedTurnCount / session.totalTurns * 100 : 0;

  return <>
    <header className="page-header studio-header">
      <div><p className="eyebrow">ACME support · fictional demo</p><h1>Live scoring studio</h1><p>Watch QA scores move as each transcript turn reaches the model.</p></div>
      <div className={`live-status live-${session?.status ?? "ready"}`}><span />{statusLabel}</div>
    </header>
    <section className="studio-controls panel">
      <label className="call-picker"><span>Replay a support call</span><div><select value={selectedId} onChange={(event) => selectCall(event.target.value)} disabled={!calls?.length || busy}>{calls?.map((call) => <option value={call.id} key={call.id}>{call.subject} · {call.customerName} · {call.agentName}</option>)}</select><ChevronDown size={16} /></div></label>
      <div className="playback-controls">
        <button className="studio-button primary" disabled={!selectedId || busy || isPlaying} onClick={() => control("start")}>{busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{session?.status === "paused" ? "Resume" : session?.status === "completed" ? "Replay" : "Start replay"}</button>
        <button className="studio-button" disabled={!session || !isPlaying || busy} onClick={() => control("pause")}><Pause size={15} />Pause</button>
        <button className="studio-button icon-only" disabled={!session || busy} onClick={() => control("reset")} aria-label="Reset replay"><RotateCcw size={16} /></button>
      </div>
      <div className="replay-progress"><div><span style={{ width: `${progress}%` }} /></div><small>{session ? `${session.revealedTurnCount} / ${session.totalTurns} turns` : "Replay not started"}</small></div>
    </section>
    {error ? <div className="inline-error studio-error"><AlertCircle size={16} />{error}</div> : null}
    <section className="studio-grid">
      <article className="panel transcript-panel">
        <div className="studio-panel-head"><div><p className="eyebrow">Transcript stream</p><h2>{selectedCall?.subject ?? "Loading calls…"}</h2></div>{session ? <span className="clock"><Timer size={13} />{(session.elapsedMs / 1000).toFixed(1)}s</span> : null}</div>
        <div className="transcript-stream" ref={transcriptStream}>
          {session?.transcript.length ? session.transcript.map((turn, index) => <div className={`live-turn ${turn.speaker}`} key={`${session.generation}-${turn.id}`}><div className="live-speaker"><span>{turn.speaker === "employee" ? selectedCall?.agentName : selectedCall?.customerName}</span><time>{timecode(turn.startSeconds)}</time></div><p>{turn.text}</p>{index === session.transcript.length - 1 && isPlaying ? <i className="speaking-dot"><span /><span /><span /></i> : null}</div>) : <StudioBlank message="Choose a call and start the replay. Transcript turns will appear here once per second." />}
        </div>
        <footer className="stream-footer"><span><CircleDot size={13} />{session ? `${session.scoredTurnCount} scored · ${session.pendingTurnCount} queued` : "Awaiting replay"}</span><span>{session?.isProcessing ? <><LoaderCircle className="spin" size={13} />Model request in flight</> : session?.processingLatencyMs !== null && session ? <><Zap size={13} />Last result {session.processingLatencyMs}ms</> : "No model request yet"}</span></footer>
      </article>
      <div className="scoring-column">
        <article className={`panel live-score-card ${session?.isProcessing ? "processing" : ""}`}>
          <div className="score-orbit"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="51"/><circle className="score-progress" cx="60" cy="60" r="51" style={{ strokeDashoffset: 320 - 3.2 * (currentScore ?? 0), stroke: currentScore === null ? "#96aaa6" : scoreColor(currentScore) }} /></svg><div><strong>{currentScore === null ? "—" : Math.round(currentScore)}</strong><span>live score</span></div></div>
          <div className="score-copy"><p className="eyebrow">Weighted QA score</p><h2>{session?.status === "completed" ? "Final result" : session?.isProcessing ? "Recalculating…" : currentScore === null ? "Awaiting first score" : "Latest snapshot"}</h2>{scoreDelta !== null ? <span className={`score-delta ${scoreDelta >= 0 ? "positive" : "negative"}`}>{scoreDelta >= 0 ? "+" : ""}{scoreDelta.toFixed(1)} since last snapshot</span> : <span className="score-delta neutral">Delta appears after the next snapshot</span>}</div>
          {session?.isProcessing ? <span className="processing-sheen" /> : null}
        </article>
        <article className="panel formula-card"><div className="formula-head"><span><Gauge size={15} />Live formula</span><small>Σ(weight × score) ÷ Σweight</small></div>{formula.terms.length ? <div className="formula-expression"><b>(</b>{formula.terms.map((term, index) => <span key={term.name}>{index > 0 ? <b>+</b> : null}<i>{term.weight} × {term.score === null ? "—" : term.score.toFixed(1)}</i></span>)}<b>) ÷ {formula.totalWeight}</b><strong>= {currentScore === null ? "—" : currentScore.toFixed(1)}</strong></div> : <p>Loading the active scorecard…</p>}</article>
        <div className="live-criteria">
          {criteria.length ? criteria.map((configured) => {
            const criterion = session?.evaluation?.criteria.find((result) => result.criterionId === configured.id);
            if (!criterion) return <article className="panel live-criterion empty" key={configured.id}><div className="criterion-live-head"><div><span className="criterion-kicker">{configured.weight}% weight</span><h3>{configured.name}</h3></div><div className="criterion-score"><strong>—</strong></div></div><p className="criterion-description">{configured.description}</p><details className="rubric-details"><summary>Rubric levels</summary><div className="rubric-levels">{configured.levels.map((level, index) => <span key={level}>{index} · {level}</span>)}</div></details><div className="confidence"><span>Confidence</span><div /><strong>—</strong></div><p className="waiting-evidence">Waiting for scored transcript evidence…</p></article>;
            const history = session!.snapshots.map((snapshot) => snapshot.criteria.find((item) => item.criterionId === criterion.criterionId)?.normalizedScore).filter((score): score is number => score !== undefined);
            const prior = previousSnapshot?.criteria.find((item) => item.criterionId === criterion.criterionId)?.normalizedScore;
            const delta = prior === undefined ? null : criterion.normalizedScore - prior;
            return <article className="panel live-criterion" key={criterion.criterionId}><div className="criterion-live-head"><div><span className="criterion-kicker">{criterion.weight}% weight</span><h3>{criterion.criterionName}</h3></div><div className="criterion-score"><strong style={{ color: scoreColor(criterion.normalizedScore) }}>{Math.round(criterion.normalizedScore)}</strong>{delta !== null ? <small className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "+" : ""}{delta.toFixed(0)}</small> : null}</div></div><p className="criterion-description">{criterion.criterionDescription}</p><details className="rubric-details"><summary>Rubric levels</summary><div className="rubric-levels">{criterion.levels.map((level, index) => <span key={level}>{index} · {level}</span>)}</div></details><Sparkline values={history} color={scoreColor(criterion.normalizedScore)} /><div className="confidence"><span>Confidence</span><div><i style={{ width: `${criterion.confidence * 100}%` }} /></div><strong>{Math.round(criterion.confidence * 100)}%</strong></div>{criterion.evidence ? <blockquote>“{criterion.evidence.text}”</blockquote> : <p className="waiting-evidence">Waiting for a supporting turn…</p>}</article>;
          }) : <div className="panel criterion-wait"><Activity size={20} /><span>Criteria will update here as TypeSafe returns scored transcript snapshots.</span></div>}
        </div>
        {session?.status === "completed" ? <div className="completion-banner"><Check size={17} /><span><strong>Replay complete</strong>Final score uses the full transcript.</span></div> : null}
      </div>
    </section>
  </>;
}
