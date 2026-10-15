// 受け渡しの約束（contract/api.ts の KikiwakeApi）の本物の実装。このファイルだけはエンジン側が持つ（Phase 2 手順5）。
// Tauri の全体用の窓口（window.__TAURI__。src-tauri/tauri.conf.json の app.withGlobalTauri）を使い、ui/package.json に部品を足さない。
// 外枠の関数は src-tauri/src/lib.rs（名前は約束の関数名を snake_case にしたもの。引数は camelCase のまま渡せば Tauri が直す）。
import type { KikiwakeApi, Unsubscribe } from "@contract/api";

type Tauri = {
  core: {
    invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    convertFileSrc(path: string, protocol?: string): string;
  };
  event: { listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> };
};

const tauri = (): Tauri => (window as unknown as { __TAURI__: Tauri }).__TAURI__;
const invoke = <T>(cmd: string, args?: Record<string, unknown>) => tauri().core.invoke<T>(cmd, args);

/** イベントを受ける。listen は Promise で返るので、外すのが先に来ても外れるようにする */
function on<T>(event: string, cb: (payload: T) => void): Unsubscribe {
  let off: (() => void) | undefined;
  let done = false;
  void tauri().event.listen<T>(event, (e) => cb(e.payload)).then((f) => (done ? f() : (off = f)));
  return () => {
    done = true;
    off?.();
  };
}

export const tauriApi: KikiwakeApi = {
  // ---- 画面1 初回セットアップ ----
  checkEnvironment: () => invoke("check_environment"),
  getModels: () => invoke("get_models"),
  downloadModels: (ids) => invoke("download_models", { ids }),
  cancelDownload: () => invoke("cancel_download"),
  onModelProgress: (cb) => on("model-progress", cb),

  // ---- 画面2 ファイル選択 ----
  pickMediaFile: () => invoke("pick_media_file"),
  onFileDrop: (cb) => on<{ paths: string[] }>("tauri://drag-drop", (p) => cb(p.paths)),
  // 版6: 外枠がドラッグの位置を画面の CSS の座標にそろえて送る（src-tauri/src/lib.rs の emit_file_drag）
  onFileDragOver: (cb) => on("file-drag", cb),
  inspectFile: (path) => invoke("inspect_file", { path }),

  // ---- 画面3 処理中 ----
  // 版13: screens（マニュアル用に、画面の絵も取り出す）
  startJob: (req) => invoke("start_job", { path: req.path, screens: req.screens ?? false }),
  cancelJob: (jobId) => invoke("cancel_job", { jobId }),
  onJobProgress: (cb) => on("job-progress", cb),
  onJobDone: (cb) => on("job-done", cb),
  onJobFailed: (cb) => on("job-failed", cb),

  // ---- 画面4 名前付け ----
  getSpeakers: (jobId) => invoke("get_speakers", { jobId }),
  getUnresolvedHints: (jobId) => invoke("get_unresolved_hints", { jobId }),
  audioSrc: (audioPath) => tauri().core.convertFileSrc(audioPath),
  applyNames: (jobId, names) => invoke("apply_names", { jobId, names }),

  // ---- 画面5 結果 ----
  getTranscript: (jobId, named) => invoke("get_transcript", { jobId, named }),
  pickFolder: (defaultDir) => invoke("pick_folder", { defaultDir: defaultDir ?? null }),
  saveOutputs: (jobId, req) => invoke("save_outputs", { jobId, req }),
  recordingSrc: async (jobId, startSec, endSec) =>
    tauri().core.convertFileSrc(await invoke<string>("recording_clip", { jobId, startSec, endSec })),
  revealInFileManager: (path) => invoke("reveal_in_file_manager", { path }),

  // ---- 全体（版5・版7） ----
  onCloseRequested: (cb) => on<null>("close-requested", () => cb()),
  closeApp: () => invoke("close_app"),
  // 版7: 画面の言語（外枠がメニューを作り直し、既定の保存先の名前と保存するファイルの中の言葉を合わせる）
  setLocale: (locale) => invoke("set_locale", { locale }),

  // ---- 版8: 履歴・閉じたときの状態 ----
  listHistory: () => invoke("list_history"),
  openHistory: (jobId) => invoke("open_history", { jobId }),
  deleteHistory: (jobId) => invoke("delete_history", { jobId }),
  relinkSource: (jobId, path) => invoke("relink_source", { jobId, path }),
  saveDraft: (jobId, draft) => invoke("save_draft", { jobId, draft }),

  // ---- 版10: 新しい版の知らせ（エンジンが GitHub に尋ねる。画面は通信しない） ----
  checkUpdate: () => invoke("check_update"),
  openReleasePage: (version) => invoke("open_release_page", { version }),
};
