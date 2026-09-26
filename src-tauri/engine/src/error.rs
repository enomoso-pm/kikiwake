//! エラー（contract の AppError）。画面にそのまま出せる日本語はここで作る。
//! 決まった文は contract/fixtures/errors.json と同じ（テストで突き合わせる）。
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)?;
        if let Some(d) = &self.detail {
            write!(f, "（{d}）")?;
        }
        Ok(())
    }
}

impl std::error::Error for AppError {}

impl AppError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: None }
    }

    /// 詳細（画面の「詳細をコピー」とログ）。ホームフォルダは「~」にする（Issue に貼っても Mac のユーザー名が出ないように）
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let d = crate::log::redact_home(&detail.into());
        self.detail = if d.is_empty() { None } else { Some(d) };
        self
    }

    pub fn file_not_found() -> Self {
        Self::new("file_not_found", "ファイルが見つかりません。移動や削除をしていないか確かめてください。")
    }
    pub fn unsupported_format() -> Self {
        Self::new("unsupported_format", "この形式には対応していません。対応している形式: mp4・mov・m4a・mp3・wav")
    }
    pub fn no_audio_track() -> Self {
        Self::new("no_audio_track", "このファイルには音声が入っていません。")
    }
    /// need_bytes: 足りない量（あと何バイト要るか）
    pub fn disk_full(need_bytes: u64) -> Self {
        let gb = (need_bytes as f64 / 1e9).ceil().max(1.0) as u64;
        Self::new("disk_full", format!("空き容量が足りません。あと約{gb}GB の空きが要ります。"))
    }
    pub fn model_missing() -> Self {
        Self::new("model_missing", "モデルが見つかりません。初回セットアップからやり直してください。")
    }
    pub fn network_unreachable() -> Self {
        Self::new(
            "network_unreachable",
            "モデルのダウンロード先（huggingface.co）に接続できません。ネットワークを確かめてください。",
        )
    }
    pub fn download_failed() -> Self {
        Self::new("download_failed", "ダウンロードが途中で止まりました。再開すると続きから取得します。")
    }
    pub fn checksum_mismatch() -> Self {
        Self::new("checksum_mismatch", "ダウンロードしたファイルが壊れていました。もう一度取得してください。")
    }
    pub fn engine_failed() -> Self {
        Self::new(
            "engine_failed",
            "書き起こしの途中で問題が起きました。もう一度実行してください。続く場合は詳細をコピーして連絡してください。",
        )
    }
    pub fn out_of_memory() -> Self {
        Self::new("out_of_memory", "メモリが足りなくなりました。他のアプリを閉じてから、もう一度実行してください。")
    }
    /// diarization_kept: 話者の判定まで終わっていたか（やり直すと使い回す）
    pub fn cancelled(diarization_kept: bool) -> Self {
        if diarization_kept {
            Self::new("cancelled", "中止しました。話者の判定結果は残してあるので、やり直すと続きから始めます。")
        } else {
            Self::new("cancelled", "中止しました。")
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.code == "cancelled"
    }
}

/// ファイルの読み書きの失敗（作業フォルダ・保存先）。空き容量が無いときは disk_full
pub fn io_error(e: &std::io::Error, what: &str) -> AppError {
    if e.raw_os_error() == Some(libc::ENOSPC) {
        return AppError::disk_full(2_000_000_000).with_detail(format!("{what}: {e}"));
    }
    AppError::engine_failed().with_detail(format!("{what}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 決まった文が contract/fixtures/errors.json（画面の見本）と同じか
    #[test]
    fn messages_match_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../contract/fixtures/errors.json")).unwrap();
        let ours = [
            AppError::file_not_found(),
            AppError::unsupported_format(),
            AppError::no_audio_track(),
            AppError::disk_full(2_000_000_000),
            AppError::model_missing(),
            AppError::network_unreachable(),
            AppError::download_failed(),
            AppError::checksum_mismatch(),
            AppError::engine_failed(),
            AppError::out_of_memory(),
            AppError::cancelled(true),
        ];
        for e in ours {
            assert_eq!(fixture[&e.code]["message"], e.message, "{}", e.code);
        }
    }
}
