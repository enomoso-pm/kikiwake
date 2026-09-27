// 履歴（約束 版8・版9。2026-09-27 決定。仕様書に無い）: 左の録音の一覧に出す録音を読む・開く・元ファイルを選び直す。
// 書き終えた録音は処理せずに開き、閉じたときのタブ（話者・文字起こし）へ戻る。中断した録音は再開する（startJob）。消すのは objects/store
import type { HistoryItem } from "@contract/types";
import { api } from "../api";
import { getT } from "../i18n";
import { toAppError } from "../lib/errors";
import { stopPlayback } from "../lib/player";
import { startJob } from "./job";
import { enterNaming } from "./naming";
import { getState, setState } from "./state";
import { showToast } from "./ui";

export async function loadHistory(): Promise<void> {
  try {
    const history = await api.listHistory();
    setState({ history, historyError: null });
  } catch (e) {
    setState({ historyError: toAppError(e) });
  }
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
    await enterNaming(o.jobId, o.names, o.draft, true, item.saved);
  } catch (e) {
    setState({ historyError: toAppError(e) });
  } finally {
    setState({ historyOpening: null });
  }
}

/**
 * 結果の画面の「ファイルを選び直す」（元ファイルが無い録音を開いたとき）。結び直せたら行の再生ができるようになる。
 * given（ファイルの場所）を渡すと、選ぶ画面を出さずにそのファイルで結び直す（「このファイルで結び直す」: 元のファイルが変わったとき）
 */
export async function relinkSource(given?: string): Promise<void> {
  const jobId = getState().job?.jobId;
  if (!jobId) return;
  try {
    const path = given ?? (await api.pickMediaFile());
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
