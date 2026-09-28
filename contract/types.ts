// Kikiwake 画面 ⇄ エンジンの受け渡しの約束（データの形）。ここが正。
// 変更したら contract/README.md の履歴に書く。
// 版 12（2026-09-29）。数値の見本は contract/fixtures/。変更の履歴は contract/README.md。
// 書き起こしは正確さ優先（Whisper large-v3）だけ。版1にあった品質の選択（速さ優先）は無くした。

/**
 * 版7で追加。画面の言語（setLocale で知らせる）。エンジンはこれで Mac のメニュー・既定の保存先の名前・保存するファイルの中の言葉を合わせる。
 * エンジンが返す文（AppError.message・EnvironmentItem.message・ラベルの「話者A」など）は日本語のままで、訳すのは画面側
 */
export type Locale = "ja" | "en";

/** 処理の段階（この順に進む） */
export type Stage = "extract" | "diarize" | "transcribe" | "merge";

export const STAGES: readonly Stage[] = ["extract", "diarize", "transcribe", "merge"];

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  extract: "音声の取り出し",
  diarize: "話者の判定",
  transcribe: "書き起こし",
  merge: "突き合わせ",
};

// ---- 画面1 初回セットアップ ---------------------------------------------------------

export interface EnvironmentCheck {
  os: "macos" | "windows";
  osVersion: string; // 例 "26.2"
  cpu: string; // 例 "Apple M4"
  memoryGB: number;
  freeDiskGB: number; // モデルの保存先があるドライブの空き
  gpu: { kind: "metal" | "cuda" | "vulkan" | "none"; name: string };
  checks: EnvironmentItem[];
  canRun: boolean; // level "error" が1つも無ければ true
}

export interface EnvironmentItem {
  id: "os" | "cpu" | "memory" | "disk" | "gpu";
  level: "ok" | "warn" | "error";
  message: string; // 画面にそのまま出せる日本語
}

/** 初回セットアップで取得するモデル。どちらも必須（合わせて約3.2GB） */
export type ModelId = "whisper-large-v3" | "nemotron-3-diarization";

export type ModelState = "missing" | "partial" | "downloading" | "verifying" | "ready" | "error";

export interface ModelInfo {
  id: ModelId;
  label: string; // 画面の表示名。例 "書き起こし"
  sizeBytes: number;
  state: ModelState;
  /** partial / downloading のとき、ここまで取得済み（中断しても続きから再開できる） */
  downloadedBytes: number;
  error?: AppError;
}

// ---- 画面2 ファイル選択 -------------------------------------------------------------

export interface FileInfo {
  path: string;
  name: string;
  sizeBytes: number;
  durationSec: number;
  hasVideo: boolean;
  supported: boolean;
  unsupported?: AppError; // supported=false のときの理由
  /** 所要時間の目安（全段階の合計、秒）。Phase 0 の実測で係数を決める */
  estimate: { minSec: number; maxSec: number };
  /** 同じファイルの前回の結果（中止を含む）があるとき。話者判定の結果はやり直しで使い回す */
  previous?: {
    outDir: string;
    diarizationReusable: boolean;
    processedAt: string; // 版3で追加。前回の処理日 YYYY-MM-DD
    /**
     * 版6で追加。前回の書き起こしまでそろっている（同じ設定・同じモデル）。始めると書き起こしをやり直さず、
     * 1秒ほどで名前付けへ進む（2026-09-26 決定）。このとき estimate も数秒になる。
     * false なら話者判定だけを使い回し、書き起こしから始める
     */
    resultReusable: boolean;
  };
  /**
   * 版9で追加。同じ場所の録音を前に文字起こししていて、そのあとファイルが変わった（大きさか更新日時が違うので、新しい録音として扱う）。
   * 前の録音を最後に処理した日。previous（同じ録音の前回）があるときは付けない
   */
  previousChanged?: { processedAt: string };
}

/** 版6で追加。ファイルのドラッグが窓の上にある間の位置（onFileDragOver） */
export interface FileDragOver {
  /** 窓の上にある間 true。窓から出た・落としたら false */
  over: boolean;
  /** 窓の中身の左上からの位置（画面の CSS の座標。getBoundingClientRect と同じ） */
  x: number;
  y: number;
}

// ---- 画面3 処理中 ------------------------------------------------------------------

export interface JobStarted {
  jobId: string;
  /**
   * 保存先の既定。版12: 元ファイルと同じフォルダ（元ファイルのあったフォルダが無ければ書類フォルダ）。版11までは元ファイルの隣の「<名前>_文字起こし/」。
   * 画面は利用者が一度選んだ保存先を覚えていて、選んでいなければここに保存する（2026-09-29 決定）。
   * 作業用のファイル（音声・話者判定・書き起こし・names.json など）は作業フォルダ（そのまま履歴。版8）に置き、ここには保存したファイルだけを書く
   */
  outDir: string;
}

export interface JobProgress {
  jobId: string;
  stage: Stage;
  /** 書き起こしだけ 0〜100。他の段階は短い（68分の録音で合計30秒ほど）ので null（不定の表示で） */
  stagePercent: number | null;
  /** 全体の残り時間の目安（秒）。書き起こしの序盤など、まだ出せないときは null */
  etaSec: number | null;
  elapsedSec: number;
  /** 前回の話者判定の結果を使い回しているとき true */
  reusedDiarization: boolean;
}

export interface JobDone {
  jobId: string;
  outDir: string;
  speakers: number; // 話者ラベルの数
  unresolvedCount: number; // 確認用に回った件数
  /** 版6で追加。この録音で前に確定した名前（applyNames で渡したもの）。名前付けの画面に最初から入れておく。無ければ省略 */
  names?: Names;
  /** 版8で追加。閉じたときの状態（saveDraft で渡したもの）。書き起こしが変わっていれば（行の id が合わないので）省略 */
  draft?: JobDraft;
}

export interface JobFailed {
  jobId: string;
  error: AppError; // 中止も code "cancelled" でここに来る
  /** 話者判定まで終わっていれば true（やり直すと使い回す） */
  diarizationKept: boolean;
}

// ---- 画面4 名前付け ----------------------------------------------------------------

/** Python 版の speaker_hints.json と同じキー */
export type HintSource = "自己紹介" | "呼びかけ直後";

export interface NameHint {
  name: string;
  sources: Partial<Record<HintSource, number>>; // 例 { 自己紹介: 2, 呼びかけ直後: 1 }
}

export interface SpeakerSample {
  index: number; // 1〜3（序盤・中盤・終盤から1つずつ）
  start: number; // 秒
  end: number;
  text: string; // 発言の冒頭70字（超えたら末尾に「…」）
  audioPath: string; // 12秒以内の WAV。再生には api.audioSrc(audioPath) を使う
}

/**
 * short_talk: 発言時間が全体の2%未満（他の人の声の断片かもしれない）
 * mixed_voices: 1つのラベルに、違う名前の自己紹介が2人分以上ある（2人が混ざっている可能性）。呼びかけ直後だけの名前は数えない
 */
export type SpeakerWarning = "short_talk" | "mixed_voices";

export interface SpeakerCard {
  label: string; // 話者A, 話者B …（声を聞いた初登場順）
  talkSec: number;
  share: number; // 発言時間の割合 0〜1
  utterances: number; // 発話の回数
  firstSec: number; // 初登場の時刻（秒）
  hints: NameHint[]; // 件数の多い順。空なら「手がかりなし」
  samples: SpeakerSample[]; // 0〜3件
  warnings: SpeakerWarning[];
}

/**
 * 版2で追加。確認用（話者を決められなかった部分）に出てきた名前の手がかり。
 * 話者判定は録音の序盤の「誰の声か決めきれない発言」を出さないので、そこでの自己紹介は話者カードの手がかりに入らない。
 * それを拾って名前付けの画面に出す。どのラベルの人かは決めない（利用者が clips を聞いて話者カードと見比べる）。
 * 規則は話者カードの手がかりと同じ（自己紹介の強い形はどこでも、「の〇〇です」は録音の冒頭付近だけ。
 * 呼びかけ直後は、直前の話者付きの発言の末尾に「〇〇さん」があり、5秒以内に確認用の部分が始まったとき）。
 */
export interface UnresolvedHint {
  name: string; // 例 "田中"
  sources: Partial<Record<HintSource, number>>; // 例 { 自己紹介: 2 }
  clips: UnresolvedClip[]; // その名前が出てきた確認用の部分（時刻順。1つの部分につき1件）
}

export interface UnresolvedClip {
  /**
   * 聞かせる範囲（秒）。名乗った位置の約1秒前から（確認用の部分の頭より前にはしない）。
   * 呼びかけ直後は確認用の部分の頭から。end は start から最長12秒
   */
  start: number;
  end: number;
  /** 聞かせる範囲の文字（70字まで、超えたら末尾に「…」）。部分の途中から始まるときは先頭に「…」 */
  text: string;
  audioPath: string; // 12秒以内の WAV。再生には api.audioSrc(audioPath) を使う
}

/**
 * 名前の対応。キーは表示ラベル（話者A）。空文字・未指定のラベルは「話者A」のまま。
 * 同じ名前を付けたラベルは1人にまとまる（同じ人が2つのラベルに割れたときの直し方）。
 */
export type Names = Record<string, string>;

// ---- 画面5 結果 --------------------------------------------------------------------

/** transcript.json の1件と同じ形 */
export interface Utterance {
  start: number; // 秒
  end: number;
  speaker: string; // 表示ラベルまたは実名。話者を決められなかった部分は "不明"
  text: string;
  overlap: boolean; // 他の人と声が重なっていた（表示は名前の後ろに「*」）
}

/**
 * 版3: 結果の画面の1行。名前を付ける前の書き起こし（transcript.json）と同じ区切りで、
 * 名前付けをやり直しても id も区切りも変わらない。同じ名前を付けたラベルの隣り合う行も、画面ではまとめない
 * （保存するファイルでだけ、Python 版と同じく1行にまとめる）。
 */
export interface Line extends Utterance {
  id: string; // 例 "u12"。行ごとの名前・手直しの鍵（LineEdits）
  label: string; // 話者A…（確認用は "不明"）。speaker は名前付けで当てた名前（無ければ label と同じ）
}

export interface TalkTime {
  speaker: string;
  sec: number;
  share: number; // 0〜1
}

export interface TranscriptView {
  title: string;
  source: string; // 元ファイルのパス
  durationSec: number; // 1時間以上なら時刻を h:mm:ss で表示（contract/format.ts）
  createdAt: string; // YYYY-MM-DD
  diarizer: string;
  asr: string;
  named: boolean; // 実名版なら true
  /** 多い順。話者判定の区間から数えた値（行ごとの名前を反映するのは画面側。保存する .md の見出しはエンジンが反映する） */
  talkTime: TalkTime[];
  utterances: Line[]; // 本文（話者が決まったもの）。版3で Line に
  /** 確認用: 話者を決められなかった部分。消さずに別枠で見せる（無音部分の誤認識が多い）。版3で Line に */
  unresolved: Line[];
  /** 版4で追加。書き起こしが同じ文の繰り返しになって読めない範囲（時刻順）。無い・空なら何も出さない */
  repeats?: RepeatNotice[];
}

/**
 * 版4で追加。書き起こしが同じ文の繰り返しになり、人が話していた部分が読めなくなった範囲。
 * 書き起こしは止めずに最後まで続け、結果の画面の本文の上に注意の帯で知らせる（2026-09-26 決定）。
 * 無音の部分の誤認識の繰り返しは、確認用の欄に回っていて本文に入らないので、ここには入れない。
 */
export interface RepeatNotice {
  startSec: number;
  endSec: number;
  /** 範囲のうち人が話していた秒数（話者の判定の区間と重なる長さ） */
  speechSec: number;
  /** 画面にそのまま出せる日本語。例「0:16:43〜1:06:03 の書き起こしは、同じ文の繰り返しになっていて読めません」 */
  message: string;
}

/**
 * 版3: 結果の画面での手直し。画面側が持ち、保存のときに渡す（アプリを閉じると消える）。
 * 保存では手直しを当ててから、同じ名前の隣り合う行を Python 版と同じ条件で1行にまとめる。手直しが無ければ Python 版の実名版と同じ中身になる。
 */
export interface LineEdits {
  /** 行の id → その行だけの名前。前後の空白は除き、空なら付けていない扱い。確認用の行に名前を付けるのもここ */
  names?: Record<string, string>;
  /** 確定した確認用の行の id。名前が付いていれば本文に時刻順で入り、確定していないものは確認用の欄に残る */
  confirmed?: string[];
  /** 行の id → 直した後の文字（改行は空白に、前後の空白は除く。空なら直していない扱い）。元の文字は Line.text */
  texts?: Record<string, string>;
}

export type SaveFormat = "md" | "txt" | "json";

/**
 * 保存するファイルの名前は、版12から録音の名前入り: 「<元ファイルの名前（拡張子なし）>_文字起こし.<形式>」（英語の画面では「_transcript」）。
 * 名前を付けたかどうかで変えない（付けたあとで保存し直すと同じ名前になり、上書きを確かめる）。dir にそのまま書く（フォルダは作らない）。
 * 版11までは Python 版と同じ transcript_named.<形式>／transcript.<形式>（2026-09-29 に「録音の名前を入れる」に変えた）。
 * 中身は今までどおり: .md は Python 版と同じ書式、.json は transcript.json と同じ形、.txt は本文の行（「[00:12] 佐藤: …」）だけで、確認用は末尾。
 * 版7: 中の言葉は setLocale で知らせた画面の言語。英語なら見出し・確認用の欄を英語に、「話者A」「不明」を「Speaker A」「Unknown」に
 */
export interface SaveRequest {
  dir: string;
  formats: SaveFormat[];
  edits?: LineEdits; // 版3で追加
  /** 版3で追加。保存先に同じ名前のファイルがあっても上書きする（利用者が確かめたあとに true で呼び直す） */
  overwrite?: boolean;
}

export interface SaveResult {
  files: string[]; // 書き出したファイルのパス（existing があるときは空）
  /**
   * 版3で追加。保存先に同じ名前のファイルがあり、overwrite が true でなかったとき、そのパス。このときは何も書いていない。
   * 画面は上書きしてよいか確かめ、よければ overwrite: true でもう一度呼ぶ（2026-09-26 決定: いつも確かめる）
   */
  existing?: string[];
}

// ---- 履歴・閉じたときの状態（版8） -------------------------------------------------------

/** 版8: 履歴の1件の状態。書き終えた（done）か、途中（中止した・止まった・処理中に閉じた）か */
export type HistoryStatus = "done" | "unfinished";

/**
 * 版9で追加。元ファイルの状態。
 * ok: 同じ場所に同じファイルがある（大きさ・更新日時も同じ）
 * missing: 場所にファイルが無い（消した・移した・名前を変えた・外付けのドライブを外した）
 * changed: 場所にあるが大きさか更新日時が違う（編集した・書き出し直した・コピーし直した・クラウドの同期）。別の録音として扱う
 */
export type SourceState = "ok" | "missing" | "changed";

/** 版9で追加。付けた名前（一覧の行に「松本・田中ほか2人」と出す） */
export interface NamedSpeakers {
  /** 付けた名前。同じ名前を付けた話者は1つにまとめ、発言の多い順（保存するファイルの発言時間と同じ数え方） */
  names: string[];
  /** 名前を付けていない話者の数 */
  unnamed: number;
}

/**
 * 版8で追加。履歴の1件（listHistory）。作業フォルダ（~/Library/Application Support/Kikiwake/jobs/）がそのまま履歴。
 * 並びは最後に使った順（処理・名前の確定・手直しのどれか）。いま処理中の録音は入らない
 */
export interface HistoryItem {
  jobId: string;
  /** 元ファイルの名前 */
  name: string;
  /** 元ファイルの場所（処理したとき） */
  path: string;
  durationSec: number;
  /** 最後に処理した日 YYYY-MM-DD */
  processedAt: string;
  status: HistoryStatus;
  /** 話者のラベルの数（話者の判定まで済んでいれば） */
  speakers?: number;
  /** 名前を確定している */
  named: boolean;
  /** ファイルに保存していない手直しがある（JobDraft.unsaved） */
  unsavedEdits: boolean;
  /** 元ファイルが今もある（同じ場所・大きさ・更新日時）。無ければ行の再生と続きからの再開はできない（書き起こしは読める）。sourceState が ok のときだけ true */
  sourceAvailable: boolean;
  /** 途中のとき、話者の判定まで済んでいる（続きからは書き起こしから） */
  diarizationKept: boolean;
  /** 版9で追加。元ファイルの状態（見つからない・変わったを分ける） */
  sourceState: SourceState;
  /** 版9で追加。文字起こしをファイルに保存したことがある（JobDraft.savedOnce。前の版の状態は savedFiles で見る） */
  saved: boolean;
  /** 版9で追加。付けた名前。名前を確定していなければ省略 */
  namedSpeakers?: NamedSpeakers;
  /**
   * 版12で追加。最後に保存したファイル（閉じたときの状態の lastSavedFiles。無ければ savedFiles）。保存したあとで手直ししても残す。
   * 一度も保存していなければ省略。一覧の行の「…」の「Finder で表示」に使う（2026-09-29 決定: 保存の帯から「Finder で表示」を外し、一覧の行へ）
   */
  savedFiles?: string[];
}

/** 版8で追加。履歴から開いた録音（openHistory・relinkSource）。JobDone と同じ中身に、元ファイルがあるかを足したもの */
export interface HistoryOpened extends JobDone {
  /** false なら行の再生はできない（サンプルの声と確認用の手がかりの声は作業フォルダにあるので鳴る） */
  sourceAvailable: boolean;
}

/**
 * 版8で追加。閉じたときの状態（2026-09-27 決定: 閉じても・別の録音へ移っても消えず、開き直すと閉じたときの画面に戻る）。
 * 形は画面が決め、エンジンは中身を見ずに作業フォルダ（draft.json）に置いて返す（unsaved だけ履歴の一覧で使う）。
 * 行の id に結びつくので、書き起こし（結果の画面の行）が変わったらエンジンは返さない
 */
export interface JobDraft {
  /** 閉じたときの画面 */
  screen: "naming" | "result";
  /** ファイルに保存していない手直しがある（履歴の一覧に出す） */
  unsaved: boolean;
  /** 名前付けの画面で入れかけた名前（ラベル → 入力のまま）。確定した名前は JobDone.names */
  names?: Record<string, string>;
  /** 結果の画面: 行ごとの名前・確定した確認用の行・直した文字の履歴（最後が今の文字） */
  lineNames?: Record<string, string>;
  confirmed?: string[];
  textHistory?: Record<string, string[]>;
  /** 結果の画面: 表示しない人・保存の形式・保存先・最後に保存したときの手直しの記録と保存したファイル */
  hidden?: string[];
  formats?: SaveFormat[];
  outDir?: string;
  savedEdits?: string | null;
  savedFiles?: string[];
  /**
   * 版9で追加。この録音の文字起こしをファイルに保存したことがある（保存したあとで名前を変えると savedFiles は空に戻るが、これは残る）。
   * 履歴の一覧の saved（状態の印「保存前」「保存済み」「保存後に手直し」）に使う
   */
  savedOnce?: boolean;
  /**
   * 版12で追加。最後に保存したファイル（保存したあとで名前を変えると savedFiles は空に戻るが、これは次に保存するまで残す）。
   * エンジンは HistoryItem.savedFiles に入れて返す
   */
  lastSavedFiles?: string[];
}

// ---- 新しい版の知らせ（版10） -------------------------------------------------------------

/**
 * 版10で追加。新しい版の知らせ（checkUpdate）。GitHub の最新のリリース（下書きと試用版は入らない）が、今の版より新しいとき。
 * アプリは自動では入れ替えない（利用者が手順を読んで入れ替える。2026-09-27 決定）
 */
export interface UpdateInfo {
  /** 新しい版（例 "1.0.1"） */
  version: string;
  /** 今の版 */
  current: string;
  /** リリースの題（例 "Kikiwake 1.0.1"） */
  title: string;
  /** 更新内容（リリースの本文。Markdown の文字のまま） */
  notes: string;
  /** 公開日（YYYY-MM-DD。分からなければ空） */
  publishedAt: string;
  /** リリースのページ（版の番号から作る） */
  url: string;
}

// ---- エラー ------------------------------------------------------------------------

export type ErrorCode =
  | "file_not_found"
  | "unsupported_format"
  | "no_audio_track"
  | "disk_full"
  | "model_missing"
  | "network_unreachable"
  | "download_failed"
  | "checksum_mismatch"
  | "engine_failed"
  | "out_of_memory"
  | "cancelled"
  | "not_same_recording" // 版8: 履歴の「ファイルを選び直す」で、大きさか長さが元の録音と違う
  | "not_writable" // 版11: 保存先のフォルダに書き込めない（書き込む許可が無い・読み取り専用のディスク）
  | "save_failed"; // 版11: そのほかの理由で保存できない（空き容量が無いときは disk_full）

export interface AppError {
  code: ErrorCode;
  message: string; // 画面にそのまま出せる日本語（エンジン側が作る）
  detail?: string; // 問い合わせ用の技術的な詳細（「詳細をコピー」などで使う）
}
