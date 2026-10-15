// 画面3 処理中（UI 画面仕様書 §6）。知らせはジョブの id で受け分ける
import { STAGES, type JobDone, type JobFailed, type JobProgress, type Stage } from "@contract/types";
import { api } from "../api";
import { toAppError } from "../lib/errors";
import { basename } from "../lib/format";
import { stopPlayback } from "../lib/player";
import { enterNaming } from "./naming";
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

/** 版13: screens なら、マニュアル用に画面の絵も取り出す（省くと、前にマニュアル用で始めた録音の続きならエンジンが続ける） */
export async function startJob(path?: string, screens?: boolean): Promise<void> {
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
    screens: Boolean(screens),
  };
  setState({ job, dialog: null, startError: null });
  goTo("processing");
  try {
    const started = await api.startJob({ path: target, ...(screens ? { screens: true } : {}) });
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

/** 途中経過の知らせを当てたときの変わり目（段階も％も戻らない）。止まった後の知らせは当てない */
export function progressPatch(j: JobView, p: JobProgress): Partial<JobView> | null {
  if (j.status !== "running") return null;
  const stage = stageIndex(p.stage) >= stageIndex(j.stage) ? p.stage : j.stage;
  const percent =
    stage === "transcribe"
      ? Math.max(j.percent, Math.min(100, p.stagePercent ?? 0))
      : stageIndex(stage) > stageIndex("transcribe")
        ? 100
        : j.percent;
  return { stage, percent, etaSec: p.etaSec, reused: p.reusedDiarization };
}

export function onJobProgress(p: JobProgress): void {
  forJob(p.jobId, () => updateJob(p.jobId, (j) => progressPatch(j, p)));
}

export function onJobDone(d: JobDone): void {
  forJob(d.jobId, () => {
    updateJob(d.jobId, () => ({ status: "done", stage: "merge", percent: 100, endedAt: Date.now(), outDir: d.outDir || getState().job?.outDir || "" }));
    closeJobDialogs();
    // 処理した録音は元ファイルがあるので行を再生できる。版8: 閉じたときの状態があれば、閉じたときの画面へ
    setState({ playable: true, relinkError: null });
    void enterNaming(d.jobId, d.names, d.draft, false, false, d.screens);
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

/** 処理中に閉じるときの確かめに出すもの: 処理中の録音の名前と段階、順番待ちの数（2026-09-27 決定: 何が残り、何を破棄するかを書く） */
export interface CloseInfo {
  name: string;
  stage: Stage;
  /** 前回の聞き分けを使い回している（閉じても聞き分けは残る） */
  reused: boolean;
  queued: number;
}

/** 見ている録音が処理中なら、その録音（録音が主役の画面は、見ていない処理中の録音と順番待ちも数える。setCloseInfo） */
const viewedCloseInfo = (): CloseInfo | null => {
  const j = getState().job;
  return j?.status === "running" ? { name: basename(j.path), stage: j.stage, reused: j.reused, queued: 0 } : null;
};

let closeInfoOf: () => CloseInfo | null = viewedCloseInfo;

export function setCloseInfo(fn: (() => CloseInfo | null) | null): void {
  closeInfoOf = fn ?? viewedCloseInfo;
}

/** 処理中の録音（無ければ null。閉じるときに確かめない） */
export function closeInfo(): CloseInfo | null {
  return closeInfoOf();
}

/**
 * 窓を閉じようとした（約束 版5）。処理中なら処理中の確認、そうでなければそのまま閉じる。
 * 版8: 保存していない手直しは作業フォルダに残るので確かめない（2026-09-27 決定）。エンジンも処理中の間だけ知らせる
 */
export function onCloseRequested(): void {
  if (closeInfo()) setState({ dialog: "close" });
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
