// 画面が呼ぶ関数の一覧（受け渡しの約束）。
// 画面側は ui/src/api/mock.ts にこの見本実装（contract/fixtures を返す）を作って画面を組む。
// 本物の実装 ui/src/api/tauri.ts は、エンジン側が Phase 2 で書く（Tauri の invoke / イベント）。
import type {
  EnvironmentCheck,
  FileDragOver,
  FileInfo,
  HistoryItem,
  HistoryOpened,
  JobDone,
  JobDraft,
  JobFailed,
  JobProgress,
  JobStarted,
  Locale,
  ModelId,
  ModelInfo,
  Names,
  SaveRequest,
  SaveResult,
  SpeakerCard,
  SpeechLanguage,
  TranscriptView,
  UnresolvedHint,
  UpdateInfo,
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
  /**
   * 書き起こしは正確さ優先（Whisper large-v3）だけ。版1の quality は無くした。
   * 版13: screens なら、マニュアル用に画面の絵も取り出す（録画のとき。文字起こしと同時に進め、JobDone.screens で数を返す）。
   * 版15: language は録音の言語。省くと自動で見分ける（前回の書き起こしがあれば、その言語のまま使い回す）。
   * 前回の書き起こしと違う言語なら、書き起こしからやり直す（話者の判定は使い回す）
   */
  startJob(req: { path: string; screens?: boolean; language?: SpeechLanguage }): Promise<JobStarted>;
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
   * 処理中に窓を閉じようとした（⌘Q を含む）。処理中でなければ届かず、確かめずにそのまま閉じる。
   * 画面は閉じる確認（UI 画面仕様書 §2.5）を出し、「閉じる」なら closeApp() を呼ぶ。やめるなら何もしない。
   * 版8: 保存していない手直しがあっても確かめない（手直しは saveDraft で作業フォルダに残り、開き直すと戻る）。版6の setUnsavedChanges は無くした
   */
  onCloseRequested(cb: () => void): Unsubscribe;
  /** 版5で追加。処理を止めてアプリを閉じる（話者の判定まで済んでいれば、その結果は残り、次に同じ録音を処理すると使い回す） */
  closeApp(): Promise<void>;
  /**
   * 版7で追加。画面の今の言語をエンジンに知らせる（起動したとき・切り替えたとき）。エンジンはこれで Mac のメニューを作り直し、
   * 既定の保存先の名前（JobDone.outDir・FileInfo.previous.outDir）と保存するファイル（saveOutputs）の中の言葉を合わせる。
   * 覚えておき、次に開いたときのメニューも最初からこの言語で作る。知らせる前は、前に知らせた言語かこの Mac の言語（日本語なら日本語、それ以外は英語）
   */
  setLocale(locale: Locale): Promise<void>;

  // ---- 履歴・閉じたときの状態（版8） ----
  /** 履歴の一覧（最後に使った順）。書き終えた録音と、途中の録音（中止した・止まった・処理中に閉じた）の両方。いま処理中の録音は入らない */
  listHistory(): Promise<HistoryItem[]>;
  /**
   * 履歴から書き終えた録音を開く（処理はしない。書き起こしはそのまま）。元ファイルがあれば再生のために音声を取り出す（68 分の録音で約1秒）。
   * 元ファイルが無くても開ける（sourceAvailable: false。行の再生だけできない）。途中の録音は startJob(path) で続きから
   */
  openHistory(jobId: string): Promise<HistoryOpened>;
  /** 履歴から消す（その録音の作業フォルダを丸ごと）。元の録音・録画と、保存先に保存した文字起こしのファイルは消さない。元に戻せない */
  deleteHistory(jobId: string): Promise<void>;
  /**
   * 元ファイルを選び直す（移動した・名前を変えた・外付けへ移した録音を結び直す）。大きさと長さが同じなら同じ録音とみなし、
   * 作業フォルダを付け替えて開く（jobId は新しくなる。以後はファイルの画面で選んでも、この履歴に当たる）。違えば AppError not_same_recording
   */
  relinkSource(jobId: string, path: string): Promise<HistoryOpened>;
  /** 閉じたときの状態を作業フォルダに置く（変わるたびに呼ぶ）。開き直すと JobDone.draft・HistoryOpened.draft で戻る */
  saveDraft(jobId: string, draft: JobDraft): Promise<void>;

  // ---- 新しい版の知らせ（版10） ----
  /**
   * 新しい版があるか（起動したときに一度だけ呼ぶ）。GitHub の最新のリリースに、エンジンが尋ねる（画面は通信しない）。
   * 無い・確かめられない（ネットにつながらない・まだ公開していない など）ときは null。エラーにはしない
   */
  checkUpdate(): Promise<UpdateInfo | null>;
  /** その版のリリースのページをブラウザで開く（URL はエンジンが版の番号から作る） */
  openReleasePage(version: string): Promise<void>;
}
