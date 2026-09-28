//! 受け渡しの約束（contract/types.ts）のうち、処理の流れが作る型。
//! 画面向けの話者カード・結果の表示・確認用の手がかり・行・手直し・保存の結果は core の型をそのまま使う。
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// 処理の段階（この順に進む）
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Extract,
    Diarize,
    Transcribe,
    Merge,
}

// ---- 画面1 初回セットアップ ----------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentCheck {
    pub os: String,
    pub os_version: String,
    pub cpu: String,
    #[serde(rename = "memoryGB")]
    pub memory_gb: u64,
    /// 小数第1位まで（画面の例「42.8 GB」）
    #[serde(rename = "freeDiskGB")]
    pub free_disk_gb: f64,
    pub gpu: Gpu,
    pub checks: Vec<EnvironmentItem>,
    pub can_run: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Gpu {
    pub kind: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EnvironmentItem {
    pub id: String,
    pub level: Level,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Ok,
    Warn,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelState {
    Missing,
    Partial,
    Downloading,
    Verifying,
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub size_bytes: u64,
    pub state: ModelState,
    pub downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

// ---- 画面2 ファイル選択 --------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub duration_sec: f64,
    pub has_video: bool,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<AppError>,
    pub estimate: Estimate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<Previous>,
    /// 版9: 同じ場所の録音を前に文字起こししていて、そのあとファイルが変わった（大きさか更新日時が違う。新しい録音として扱う）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_changed: Option<PreviousChanged>,
}

/// 版9: 同じ場所の前の録音（そのあとファイルが変わった）
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousChanged {
    /// 前の録音を最後に処理した日（YYYY-MM-DD）
    pub processed_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Estimate {
    pub min_sec: u64,
    pub max_sec: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Previous {
    pub out_dir: String,
    pub diarization_reusable: bool,
    pub processed_at: String,
    /// 版6: 前回の書き起こしまでそろっていて、始めると書き起こしをやり直さずに1秒ほどで名前付けへ進む
    pub result_reusable: bool,
}

// ---- 画面3 処理中 --------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStarted {
    pub job_id: String,
    pub out_dir: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    pub stage: Stage,
    /// 書き起こしだけ 0〜100。他の段階は null
    pub stage_percent: Option<f64>,
    pub eta_sec: Option<u64>,
    pub elapsed_sec: u64,
    pub reused_diarization: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDone {
    pub job_id: String,
    pub out_dir: String,
    pub speakers: usize,
    pub unresolved_count: usize,
    /// 版6: この録音で前に確定した名前（names.json）。名前付けの画面に最初から入れておく
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub names: Option<kikiwake_core::merge::Names>,
    /// 版8: 閉じたときの状態（画面が saveDraft で渡したもの。中身は画面が決める）。書き起こしが変わっていれば省く
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<serde_json::Value>,
}

// ---- 履歴（版8） ---------------------------------------------------------------------

/// 履歴の1件の状態: 書き終えた（done）か、途中（中止・止まった・処理中に閉じた）か
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryStatus {
    Done,
    Unfinished,
}

/// 版9: 元ファイルの状態。ok＝同じ場所に同じファイル（大きさ・更新日時も同じ）、missing＝場所にファイルが無い、
/// changed＝場所にあるが大きさか更新日時が違う（編集した・書き出し直した・コピーし直した・クラウドの同期）
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceState {
    Ok,
    Missing,
    Changed,
}

/// 版9: 付けた名前（一覧の行に「松本・田中ほか2人」と出す）
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedSpeakers {
    /// 付けた名前。同じ名前を付けた話者は1つにまとめ、発言の多い順
    pub names: Vec<String>,
    /// 名前を付けていない話者の数
    pub unnamed: usize,
}

/// contract の HistoryItem
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub job_id: String,
    /// 元ファイルの名前
    pub name: String,
    /// 元ファイルの場所（処理したとき）
    pub path: String,
    pub duration_sec: f64,
    /// 最後に処理した日（YYYY-MM-DD）
    pub processed_at: String,
    pub status: HistoryStatus,
    /// 話者のラベルの数（話者の判定まで済んでいれば）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speakers: Option<usize>,
    /// 名前を確定している
    pub named: bool,
    /// ファイルに保存していない手直しがある（閉じたときの状態の unsaved）
    pub unsaved_edits: bool,
    /// 元ファイルが今もある（同じ場所・大きさ・更新日時）。無ければ再生と続きからの再開ができない
    pub source_available: bool,
    /// 途中のとき、話者の判定まで済んでいる（続きからは書き起こしから）
    pub diarization_kept: bool,
    /// 版9: 元ファイルの状態（source_available は ok のときだけ true）
    pub source_state: SourceState,
    /// 版9: 文字起こしをファイルに保存したことがある（閉じたときの状態の savedOnce）
    pub saved: bool,
    /// 版9: 付けた名前（名前を確定していなければ省く）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub named_speakers: Option<NamedSpeakers>,
    /// 版12: 最後に保存したファイル（閉じたときの状態の lastSavedFiles。無ければ savedFiles）。一度も保存していなければ省く。
    /// 一覧の行の「…」の「Finder で表示」に使う
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_files: Option<Vec<String>>,
}

/// contract の HistoryOpened（openHistory・relinkSource の答え）: JobDone と同じ中身と、元ファイルがあるか
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryOpened {
    #[serde(flatten)]
    pub done: JobDone,
    pub source_available: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobFailed {
    pub job_id: String,
    pub error: AppError,
    pub diarization_kept: bool,
}

// ---- 画面5 結果 ----------------------------------------------------------------------

/// 版4: 書き起こしが同じ文の繰り返しになって読めない範囲（結果の画面の本文の上に注意の帯で出す）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatNotice {
    pub start_sec: f64,
    pub end_sec: f64,
    pub speech_sec: f64,
    pub message: String,
}

/// contract の TranscriptView（版4）。core の TranscriptView に repeats を並べて書き出す
#[derive(Clone, Debug, Serialize)]
pub struct TranscriptOut {
    #[serde(flatten)]
    pub view: kikiwake_core::view::TranscriptView,
    pub repeats: Vec<RepeatNotice>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub dir: String,
    pub formats: Vec<kikiwake_core::lines::SaveFormat>,
    #[serde(default)]
    pub edits: Option<kikiwake_core::lines::LineEdits>,
    #[serde(default)]
    pub overwrite: Option<bool>,
}

/// 処理の流れから画面へ知らせる（Tauri のイベント・画面なしのコマンドの出力）
pub trait Events: Send + Sync {
    fn job_progress(&self, p: &JobProgress);
    fn job_done(&self, d: &JobDone);
    fn job_failed(&self, f: &JobFailed);
    fn model_progress(&self, m: &ModelInfo);
}

// ---- 新しい版の知らせ（版10） ----------------------------------------------------------

/// contract の UpdateInfo（checkUpdate の答え）: GitHub の最新のリリースが、今の版より新しいとき
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 新しい版（例 "1.0.1"）
    pub version: String,
    /// 今の版
    pub current: String,
    /// リリースの題（例 "Kikiwake 1.0.1"）
    pub title: String,
    /// 更新内容（リリースの本文。Markdown の文字のまま）
    pub notes: String,
    /// 公開日（YYYY-MM-DD。分からなければ空）
    pub published_at: String,
    /// リリースのページ（版の番号から作る）
    pub url: String,
}
