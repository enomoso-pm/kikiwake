// 起動: エンジンからの知らせを受ける準備をして、動作条件と AI モデルを読む
import { api } from "../api";
import { getLocale, useLocale, type Locale } from "../i18n";
import { onFileDragOver, onFileDrop } from "./file";
import { onCloseRequested, onJobDone, onJobFailed, onJobProgress } from "./job";
import { watchDraft } from "./draft";
import { allModelsReady, loadSetup, onModelProgress } from "./setup";
import { getState, setState } from "./state";
import { checkForUpdate } from "./update";

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
  // 版8: 閉じたときの状態を、変わるたびに作業フォルダへ（閉じる前に確かめないため）
  watchDraft();
  watchLocale();
  await loadSetup();
  const s = getState();
  // 2回目以降の起動: AI モデルがそろい、動作条件に error が無ければ、ファイル選択から（§13 Q1 の仮の扱い）
  const skipSetup = allModelsReady(s.models) && Boolean(s.env?.canRun);
  setState({ booted: true, screen: skipSetup ? "file" : "setup" });
  // 新しい版があるか（約束 版10。一度だけ。答えを待たずに画面を出す）
  void checkForUpdate();
}

/**
 * 画面の言語を、起動したときと切り替えたときにエンジンに知らせる（約束 版7）。
 * エンジンはこれで Mac のメニュー・既定の保存先の名前・保存するファイルの中の言葉を合わせる
 */
function watchLocale(): void {
  const tell = (locale: Locale) =>
    api.setLocale(locale).catch(() => {
      // 知らせられなくても画面は動く（メニューと保存するファイルが前の言語のままになるだけ）
    });
  void tell(getLocale());
  useLocale.subscribe((s, prev) => {
    if (s.locale !== prev.locale) void tell(s.locale);
  });
}
