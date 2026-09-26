// 画面が呼ぶ関数の一覧（受け渡しの約束）。
// 画面側は ui/src/api/mock.ts にこの見本実装（contract/fixtures を返す）を作って画面を組む。
// 本物の実装 ui/src/api/tauri.ts は、エンジン側が Phase 2 で書く（Tauri の invoke / イベント）。
import type {
  EnvironmentCheck,
  FileDragOver,
  FileInfo,
  JobDone,
  JobFailed,
  JobProgress,
  JobStarted,
  ModelId,
  ModelInfo,
  Names,
  SaveRequest,
  SaveResult,
  SpeakerCard,
  TranscriptView,
  UnresolvedHint,
} from "./types";

export type Unsubscribe = () => void;

export interface KikiwakeApi {
  // ---- 画面1 初回セットアップ ----
  checkEnvironment(): Promise<EnvironmentCheck>;
  getModels(): Promise<ModelInfo[]>;
  /** 取得を始める。進み具合は onModelProgress で届く。中断は cancelDownload（続きから再開できる） */
  downloadModels(ids: ModelId[]): Promise<void>;
  cancelDownload(): Promise<void>;
  onModelProgress(cb: (m: ModelInfo) => void): Unsubscribe;

  // ---- 画面2 ファイル選択 ----
  /** OS のファイル選択画面を開く。キャンセルなら null */
  pickMediaFile(): Promise<string | null>;
  /**
   * ウィンドウへのドラッグ＆ドロップ。Tauri ではファイルのパスがこのイベントで届く
   * （HTML5 の drop イベントの File からはパスが取れないので使わない）
   */
  onFileDrop(cb: (paths: string[]) => void): Unsubscribe;
  /**
   * 版6で追加。ファイルのドラッグが窓の上にある間、位置を知らせる（動くたび）。窓から出た・落としたら over: false。
   * 画面は位置がドロップ枠の中かで枠の色を変える（UI 画面仕様書 §5.2）。アプリの中では HTML5 の dragenter・dragover は画面に届かない
   */
  onFileDragOver(cb: (e: FileDragOver) => void): Unsubscribe;
  inspectFile(path: string): Promise<FileInfo>;

  // ---- 画面3 処理中 ----
  /** 書き起こしは正確さ優先（Whisper large-v3）だけ。版1の quality は無くした */
  startJob(req: { path: string }): Promise<JobStarted>;
  /** 中止。onJobFailed に code "cancelled" が届く。話者判定の結果は残る */
  cancelJob(jobId: string): Promise<void>;
  onJobProgress(cb: (p: JobProgress) => void): Unsubscribe;
  onJobDone(cb: (d: JobDone) => void): Unsubscribe;
  onJobFailed(cb: (f: JobFailed) => void): Unsubscribe;

  // ---- 画面4 名前付け ----
  getSpeakers(jobId: string): Promise<SpeakerCard[]>;
  /** 版2で追加。確認用に回った部分にある名前の手がかり（件数の多い順）。無ければ [] */
  getUnresolvedHints(jobId: string): Promise<UnresolvedHint[]>;
  /** サンプル音声の <audio src> に入れる URL */
  audioSrc(audioPath: string): string;
  /**
   * 名前を確定する。names.json と実名版を作業フォルダ（アプリのキャッシュ）に作り、実名版の行を返す。
   * 版3: 行は名前でまとめない（id・区切りは名前付けの前と同じ）。空の名前は付けていない扱い
   */
  applyNames(jobId: string, names: Names): Promise<TranscriptView>;

  // ---- 画面5 結果 ----
  getTranscript(jobId: string, named: boolean): Promise<TranscriptView>;
  /** OS のフォルダ選択画面。キャンセルなら null */
  pickFolder(defaultDir?: string): Promise<string | null>;
  /** 手直し（req.edits）を当てて保存する。同じ名前のファイルがあれば、overwrite でない限り書かずに SaveResult.existing を返す */
  saveOutputs(jobId: string, req: SaveRequest): Promise<SaveResult>;
  /** 版3で追加。録音の startSec〜endSec 秒を再生する <audio src> の URL（結果の画面の行の再生） */
  recordingSrc(jobId: string, startSec: number, endSec: number): Promise<string>;
  /** Finder / エクスプローラーでファイルやフォルダを表示する */
  revealInFileManager(path: string): Promise<void>;

  // ---- 全体（版5で追加） ----
  /**
   * 処理中、または setUnsavedChanges(true) のあいだに窓を閉じようとした（⌘Q を含む）。どちらでもなければ届かず、確かめずにそのまま閉じる。
   * 画面は理由に合った閉じる確認（UI 画面仕様書 §2.5・保存していない手直し）を出し、「閉じる」なら closeApp() を呼ぶ。やめるなら何もしない
   */
  onCloseRequested(cb: () => void): Unsubscribe;
  /**
   * 版6で追加。保存していない手直しがあるかをエンジンに知らせる（変わるたびに呼ぶ）。
   * true のあいだと処理中は、窓を閉じようとすると閉じずに onCloseRequested が届く。画面が応えられなくなっても、false なら閉じられる
   */
  setUnsavedChanges(unsaved: boolean): Promise<void>;
  /** 版5で追加。処理を止めてアプリを閉じる（話者の判定まで済んでいれば、その結果は残り、次に同じ録音を処理すると使い回す） */
  closeApp(): Promise<void>;
}
