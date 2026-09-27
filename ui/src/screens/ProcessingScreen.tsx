// 画面3 処理中（UI 画面仕様書 §6）
import { useEffect, useState } from "react";
import { STAGES, type Stage } from "@contract/types";
import { Bar, IndeterminateBar } from "../components/Bar";
import { useT, type Messages } from "../i18n";
import { basename, formatClock, formatRemaining } from "../lib/format";
import { backToFile, requestCancel, retryJob } from "../store/job";
import { useApp, type JobView } from "../store/state";
import { copyErrorDetail } from "../store/ui";

/** 動いている間だけ、1秒ごとに今の時刻を返す（経過時間の表示） */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

interface StageRow {
  stage: Stage;
  dot: string;
  text: string;
  color: string;
  bold: boolean;
  sub: string;
}

function stageRows(t: Messages, job: JobView): StageRow[] {
  const p = t.processing;
  const cur = STAGES.indexOf(job.stage);
  return STAGES.map((stage, i) => {
    const sub = stage === "transcribe" ? p.subTranscribe : stage === "diarize" && job.reused ? p.subReused : "";
    const base = { stage, sub, bold: false };
    if (stage === "diarize" && job.reused) return { ...base, dot: "var(--ok-bar)", text: p.reused, color: "var(--ok-ink)" };
    if (job.status === "done" || i < cur) return { ...base, dot: "var(--ok-bar)", text: p.done, color: "var(--ok-ink)" };
    if (i > cur) return { ...base, dot: "var(--wait-dot)", text: p.waiting, color: "var(--ink-4)" };
    if (job.status === "cancelled") return { ...base, dot: "var(--paused-bar)", text: p.cancelled, color: "var(--ink-3)" };
    if (job.status === "failed") return { ...base, dot: "var(--err-bar)", text: p.failed, color: "var(--err-ink)" };
    return {
      ...base,
      bold: true,
      dot: "var(--accent)",
      text: stage === "transcribe" ? `${Math.floor(job.percent)}%` : p.inProgress,
      color: "var(--accent)",
    };
  });
}

function remainingText(t: Messages, job: JobView): string {
  if (job.status !== "running") return "";
  if (job.stage === "merge") return t.processing.almostDone;
  if (job.stage === "transcribe" && job.etaSec !== null) return formatRemaining(job.etaSec);
  return t.processing.calculating;
}

export function ProcessingScreen() {
  const t = useT();
  const job = useApp((s) => s.job);
  const fileName = useApp((s) => s.file?.name);
  const now = useNow(job?.status === "running");
  if (!job) return null;

  const running = job.status === "running";
  const stopped = job.status === "cancelled" || job.status === "failed";
  const transcribing = job.stage === "transcribe";
  const elapsed = ((job.endedAt ?? Math.max(now, job.startedAt)) - job.startedAt) / 1000;
  const barColor = job.status === "failed" ? "var(--err-bar)" : job.status === "cancelled" ? "var(--paused-bar)" : "var(--accent)";
  const keptText = job.diarizationKept ? t.processing.kept : t.processing.notKept;

  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 32px", display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, color: "var(--ink-3)", overflowWrap: "anywhere" }}>{fileName ?? basename(job.path)}</span>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>{t.processing.title[job.status]}</h1>
        </div>

        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", gap: 12, padding: "22px 24px", borderRadius: 10 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{t.engine.stage(job.stage)}</span>
            {transcribing ? (
              <span className="num" style={{ fontSize: 28, fontWeight: 600 }}>
                {Math.floor(job.percent)}%
              </span>
            ) : null}
          </div>
          {transcribing ? (
            <Bar ratio={job.percent / 100} height={8} color={barColor} />
          ) : running ? (
            <IndeterminateBar height={8} />
          ) : null}
          <div
            className="num"
            style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, color: "var(--ink-3)" }}
          >
            <span>{remainingText(t, job)}</span>
            <span className="nowrap">{t.processing.elapsed(formatClock(elapsed))}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {stageRows(t, job).map((r, i) => (
            <div
              key={r.stage}
              style={{
                display: "grid",
                gridTemplateColumns: "14px minmax(0, 1fr) auto",
                gap: 14,
                alignItems: "start",
                padding: "12px 4px",
                borderTop: i ? "1px solid var(--line)" : "none",
              }}
            >
              <span className="dot" style={{ width: 10, height: 10, marginTop: 5, background: r.dot }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: r.bold ? 600 : 400 }}>{t.engine.stage(r.stage)}</span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.sub}</span>
              </div>
              <span className="num nowrap" style={{ fontSize: 13, color: r.color }}>
                {r.text}
              </span>
            </div>
          ))}
        </div>

        {job.status === "failed" && job.error ? (
          <div
            className="band-error"
            role="alert"
            style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 18px" }}
          >
            <span className="pretty" style={{ fontSize: 14, lineHeight: 1.7 }}>
              {t.engine.error(job.error)}
            </span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13 }}>{keptText}</span>
              <button type="button" className="btn-copy" onClick={() => job.error && void copyErrorDetail(job.error)}>
                {t.common.copyDetail}
              </button>
            </div>
          </div>
        ) : null}
        {job.status === "cancelled" ? (
          <div style={{ padding: "14px 18px", borderRadius: 8, background: "var(--bg-muted)", fontSize: 14, lineHeight: 1.7 }}>
            {keptText}
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{stopped ? "" : t.processing.local}</span>
          <div style={{ display: "flex", gap: 10 }}>
            {running ? (
              <button type="button" className="btn btn-secondary compact" disabled={job.cancelRequested} onClick={requestCancel}>
                {t.processing.cancel}
              </button>
            ) : null}
            {stopped ? (
              <>
                <button type="button" className="btn btn-secondary compact" onClick={backToFile}>
                  {t.processing.back}
                </button>
                <button type="button" className="btn btn-primary" style={{ padding: "9px 20px" }} onClick={retryJob}>
                  {t.processing.retry}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
