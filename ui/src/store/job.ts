// 画面3 処理中（UI 画面仕様書 §6）。知らせはジョブの id で受け分ける
import { STAGES, type JobDone, type JobFailed, type JobProgress, type Stage } from "@contract/types";
import { api } from "../api";
import { toAppError } from "../lib/errors";
import { stopPlayback } from "../lib/player";
import { enterNaming } from "./naming";
import { hasUnsavedEdits } from "./result";
import { getState, setState, type JobView } from "./state";
import { goTo } from "./ui";

const stageIndex = (s: Stage) => STAGES.indexOf(s);

/** startJob が返る前に届いた知らせ（返ったら順に当てる） */
const early: Array<{ jobId: string; apply: () => void }> = [];
let startSeq = 0;

function forJob(jobId: string, apply: () => void): void {
  const j = getState().job;
  if (j && j.jobId === jobId) apply();
  else if (j && j.jobId === null && early.length < 200) early.push({ jobId, apply });
}

function updateJob(jobId: string, patch: (j: JobView) => Partial<JobView> | null): void {
  setState((s) => {
    const j = s.job;
    if (!j || j.jobId !== jobId) return {};
    const p = patch(j);
    return p ? { job: { ...j, ...p } } : {};
  });
}

/** 話者の判定まで済んだか（中止の確認の文を変える） */
export function diarizationDone(j: JobView): boolean {
  return j.reused || stageIndex(j.stage) > stageIndex("diarize");
}

export async function startJob(path?: string): Promise<void> {
  const s = getState();
  const target = path ?? s.file?.path;
  if (!target) return;
  const my = ++startSeq;
  early.length = 0;
  stopPlayback();
  const job: JobView = {
    jobId: null,
    path: target,
    outDir: "",
    status: "running",
    stage: "extract",
    percent: 0,
    etaSec: null,
    reused: Boolean(s.file?.path === target && s.file.previous?.diarizationReusable),
    startedAt: Date.now(),
    endedAt: null,
    error: null,
    diarizationKept: false,
    cancelRequested: false,
  };
  setState({ job, dialog: null, startError: null });
  goTo("processing");
  try {
    const started = await api.startJob({ path: target });
    if (my !== startSeq) return;
    setState((st) => (st.job ? { job: { ...st.job, jobId: started.jobId, outDir: started.outDir } } : {}));
    const pending = early.splice(0).filter((e) => e.jobId === started.jobId);
    pending.forEach((e) => e.apply());
  } catch (e) {
    if (my !== startSeq) return;
    setState((st) => ({
      job: st.job ? { ...st.job, status: "failed", error: toAppError(e), endedAt: Date.now() } : null,
    }));
  }
}

export function onJobProgress(p: JobProgress): void {
  forJob(p.jobId, () =>
    updateJob(p.jobId, (j) => {
      if (j.status !== "running") return null;
      const stage = stageIndex(p.stage) >= stageIndex(j.stage) ? p.stage : j.stage;
      const percent =
        stage === "transcribe"
          ? Math.max(j.percent, Math.min(100, p.stagePercent ?? 0))
          : stageIndex(stage) > stageIndex("transcribe")
            ? 100
            : j.percent;
      return { stage, percent, etaSec: p.etaSec, reused: p.reusedDiarization };
    }),
  );
}

export function onJobDone(d: JobDone): void {
  forJob(d.jobId, () => {
    updateJob(d.jobId, () => ({ status: "done", stage: "merge", percent: 100, endedAt: Date.now(), outDir: d.outDir || getState().job?.outDir || "" }));
    closeJobDialogs();
    void enterNaming(d.jobId, d.names);
  });
}

export function onJobFailed(f: JobFailed): void {
  forJob(f.jobId, () => {
    updateJob(f.jobId, () => ({
      status: f.error.code === "cancelled" ? "cancelled" : "failed",
      error: f.error,
      diarizationKept: f.diarizationKept,
      endedAt: Date.now(),
      cancelRequested: false,
    }));
    closeJobDialogs();
  });
}

function closeJobDialogs(): void {
  const d = getState().dialog;
  if (d === "cancel" || d === "close") setState({ dialog: null });
}

export function requestCancel(): void {
  if (getState().job?.status === "running") setState({ dialog: "cancel" });
}

export async function confirmCancel(): Promise<void> {
  const j = getState().job;
  setState({ dialog: null });
  if (!j || j.status !== "running" || !j.jobId) return;
  updateJob(j.jobId, () => ({ cancelRequested: true }));
  try {
    await api.cancelJob(j.jobId);
  } catch (e) {
    updateJob(j.jobId, () => ({ cancelRequested: false, status: "failed", error: toAppError(e), endedAt: Date.now() }));
  }
}

/** やり直す（残っている話者の判定はエンジンが使い回す） */
export function retryJob(): void {
  const j = getState().job;
  if (j) void startJob(j.path);
}

/** ファイル選択に戻る（選んだファイルは消える） */
export function backToFile(): void {
  setState({ job: null, file: null, fileError: null, startError: null });
  goTo("file");
}

/**
 * 窓を閉じようとした（約束 版5・版6）。処理中なら処理中の確認、保存していない手直しがあればその確認（2026-09-26 決定）、
 * どちらでもなければそのまま閉じる。エンジンは処理中か、setUnsavedChanges(true) の間だけ知らせる（store/bootstrap.ts）
 */
export function onCloseRequested(): void {
  const s = getState();
  if (s.job?.status === "running") setState({ dialog: "close" });
  else if (hasUnsavedEdits(s)) setState({ dialog: "closeUnsaved" });
  else void confirmClose();
}

export async function confirmClose(): Promise<void> {
  setState({ dialog: null });
  try {
    await api.closeApp();
  } catch {
    // 閉じられなかったときは、そのまま続ける
  }
}
