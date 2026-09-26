// 起動: エンジンからの知らせを受ける準備をして、動作条件と AI モデルを読む
import { api } from "../api";
import { onFileDragOver, onFileDrop } from "./file";
import { onCloseRequested, onJobDone, onJobFailed, onJobProgress } from "./job";
import { hasUnsavedEdits } from "./result";
import { allModelsReady, loadSetup, onModelProgress } from "./setup";
import { getState, setState, useApp } from "./state";

let started = false;

export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;
  api.onModelProgress(onModelProgress);
  api.onFileDrop(onFileDrop);
  api.onFileDragOver(onFileDragOver);
  api.onJobProgress(onJobProgress);
  api.onJobDone(onJobDone);
  api.onJobFailed(onJobFailed);
  api.onCloseRequested(onCloseRequested);
  watchUnsavedEdits();
  await loadSetup();
  const s = getState();
  // 2回目以降の起動: AI モデルがそろい、動作条件に error が無ければ、ファイル選択から（§13 Q1 の仮の扱い）
  const skipSetup = allModelsReady(s.models) && Boolean(s.env?.canRun);
  setState({ booted: true, screen: skipSetup ? "file" : "setup" });
}

/**
 * 保存していない手直しがあるかを、変わるたびにエンジンに知らせる（約束 版6）。
 * エンジンは、処理中か、ここで true を知らせている間だけ、閉じる前に onCloseRequested で確かめさせる
 */
function watchUnsavedEdits(): void {
  let last = false;
  useApp.subscribe((s, prev) => {
    // 手直しに関わる所が変わったときだけ数え直す（検索の入力などでは数え直さない）
    if (
      s.view === prev.view &&
      s.lineNames === prev.lineNames &&
      s.confirmed === prev.confirmed &&
      s.textHistory === prev.textHistory &&
      s.appliedNames === prev.appliedNames &&
      s.savedEdits === prev.savedEdits
    ) {
      return;
    }
    const now = hasUnsavedEdits(s);
    if (now === last) return;
    last = now;
    api.setUnsavedChanges(now).catch(() => {
      // 知らせられなくても画面は動く（閉じる前の確認が出ないだけ）
    });
  });
}
