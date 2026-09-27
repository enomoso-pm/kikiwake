// 履歴（約束 版8。2026-09-27 決定。仕様書に無い）: ファイルの画面から入る一覧・開く・消す・元ファイルを選び直す。
// 書き終えた録音は処理せずに開き、閉じたときの画面（名前付け・結果）へ戻る。途中の録音は続きから処理する（startJob）
import type { HistoryItem } from "@contract/types";
import { api } from "../api";
import { getT } from "../i18n";
import { toAppError } from "../lib/errors";
import { stopPlayback } from "../lib/player";
import { startJob } from "./job";
import { enterNaming } from "./naming";
import { getState, setState } from "./state";
import { goTo, showToast } from "./ui";

export async function loadHistory(): Promise<void> {
  try {
    const history = await api.listHistory();
    setState({ history, historyError: null });
  } catch (e) {
    setState({ historyError: toAppError(e) });
  }
}

/** ファイルの画面の「履歴」（前に読んだ一覧は見せない。消した録音などが一瞬出ないように） */
export async function showHistory(): Promise<void> {
  setState({ historyError: null, history: null });
  goTo("history");
  await loadHistory();
}

export function backToFileScreen(): void {
  setState({ historyError: null });
  goTo("file");
}

/** 開く: 書き終えた録音は処理せずに開き（元ファイルがあれば再生のために音声を取り出す）、途中の録音は続きから処理する */
export async function openHistoryItem(item: HistoryItem): Promise<void> {
  if (getState().historyOpening) return;
  if (item.status === "unfinished") {
    if (!item.sourceAvailable) return;
    setState({ file: null, playable: true, relinkError: null });
    void startJob(item.path);
    return;
  }
  setState({ historyOpening: item.jobId, historyError: null });
  try {
    const o = await api.openHistory(item.jobId);
    stopPlayback();
    const now = Date.now();
    setState({
      file: null,
      playable: o.sourceAvailable,
      relinkError: null,
      job: {
        jobId: o.jobId,
        path: item.path,
        outDir: o.outDir,
        status: "done",
        stage: "merge",
        percent: 100,
        etaSec: null,
        reused: true,
        startedAt: now,
        endedAt: now,
        error: null,
        diarizationKept: true,
        cancelRequested: false,
      },
    });
    await enterNaming(o.jobId, o.names, o.draft, true);
  } catch (e) {
    setState({ historyError: toAppError(e) });
  } finally {
    setState({ historyOpening: null });
  }
}

export function requestDeleteHistory(item: HistoryItem): void {
  setState({ historyDelete: item, dialog: "deleteHistory" });
}

export function cancelDeleteHistory(): void {
  setState({ historyDelete: null, dialog: null });
}

/** 消す（その録音の作業フォルダを丸ごと。元の録音と保存したファイルは消えない） */
export async function confirmDeleteHistory(): Promise<void> {
  const item = getState().historyDelete;
  setState({ historyDelete: null, dialog: null });
  if (!item) return;
  try {
    await api.deleteHistory(item.jobId);
    showToast(getT().toast.deleted);
  } catch (e) {
    setState({ historyError: toAppError(e) });
  }
  await loadHistory();
}

/** 結果の画面の「ファイルを選び直す」（元ファイルが無い録音を開いたとき）。結び直せたら行の再生ができるようになる */
export async function relinkSource(): Promise<void> {
  const jobId = getState().job?.jobId;
  if (!jobId) return;
  try {
    const path = await api.pickMediaFile();
    if (!path) return;
    const o = await api.relinkSource(jobId, path);
    setState((s) => ({
      job: s.job ? { ...s.job, jobId: o.jobId, path } : s.job,
      playable: o.sourceAvailable,
      relinkError: null,
    }));
    showToast(getT().toast.relinked);
  } catch (e) {
    setState({ relinkError: toAppError(e) });
  }
}
