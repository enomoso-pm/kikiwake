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

    /// 版8: 履歴の「ファイルを選び直す」で、選んだファイルが元の録音と違う（大きさか長さが違う）
    pub fn not_same_recording() -> Self {
        Self::new("not_same_recording", "選んだファイルは、この録音と大きさか長さが違います。元の録音を選んでください。")
    }

    /// 版11: 保存先のフォルダに書き込めない（書き込む許可が無い・読み取り専用のディスク）
    pub fn not_writable() -> Self {
        Self::new(
            "not_writable",
            "このフォルダには保存できません（書き込む許可がありません）。「保存…」の保存先で、別のフォルダを選んでください。",
        )
    }
    /// 版11: そのほかの理由で保存できない（空き容量が無いときは disk_full）
    pub fn save_failed() -> Self {
        Self::new(
            "save_failed",
            "保存できませんでした。保存先を確かめて、もう一度保存してください。続く場合は詳細をコピーして連絡してください。",
        )
    }

    /// 版13: マニュアルの素材の絵を取り出せない（映像が無い・画面の共有が見つからない・映像を読めない）
    pub fn screens_unavailable() -> Self {
        Self::new("screens_unavailable", "この録画からは、画面の絵を取り出せませんでした（画面の共有が見つからない・映像を読めない）。")
    }
    /// 版13: マニュアルの素材を作るには元の録画が要る（行の再生と同じく、移したり書き換えたりしたら作れない）
    pub fn screens_source_missing() -> Self {
        Self::new(
            "screens_source_missing",
            "マニュアルの素材を作るには、元の録画が要ります。元の録画を移したり消したりしていないか確かめてください。",
        )
    }
    /// 版14: マニュアルの素材の画面の読み取りが前の版のもの（判定の版が上がって、絵の選び方が変わった）。
    /// 新しい録音として選び直すと、文字起こしは使い回して画面だけ読み取り直す
    pub fn screens_outdated() -> Self {
        Self::new(
            "screens_outdated",
            "画面の絵の選び方が、新しい版で変わりました。マニュアルの素材を作るには、「新しい録音」でこの録画を選び直し、「マニュアル用に、画面の絵も取り出す」にチェックを入れてはじめてください（文字起こしはやり直しません）。",
        )
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

/// 保存先（使う人が選んだフォルダ）への書き込みの失敗（版11）。io_error と違い、文字起こしの失敗の文（engine_failed）にしない。
/// 書き込めない（許可が無い・読み取り専用）は not_writable、空き容量が無いときは disk_full、ほかは save_failed
pub fn save_error(e: &std::io::Error, dir: &str) -> AppError {
    let detail = format!("{dir}: {e}");
    if e.raw_os_error() == Some(libc::ENOSPC) {
        return AppError::disk_full(2_000_000_000).with_detail(detail);
    }
    if e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(libc::EROFS) {
        return AppError::not_writable().with_detail(detail);
    }
    AppError::save_failed().with_detail(detail)
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
            AppError::not_same_recording(),
            AppError::not_writable(),
            AppError::save_failed(),
            AppError::screens_unavailable(),
            AppError::screens_source_missing(),
            AppError::screens_outdated(),
        ];
        for e in ours {
            assert_eq!(fixture[&e.code]["message"], e.message, "{}", e.code);
        }
    }

    /// 保存の失敗の分け方（版11）: 書き込めない・読み取り専用は not_writable、空き容量は disk_full、ほかは save_failed
    #[test]
    fn save_errors_are_classified() {
        let code = |errno| save_error(&std::io::Error::from_raw_os_error(errno), "/保存先").code;
        assert_eq!(code(libc::EACCES), "not_writable");
        assert_eq!(code(libc::EPERM), "not_writable");
        assert_eq!(code(libc::EROFS), "not_writable");
        assert_eq!(code(libc::ENOSPC), "disk_full");
        assert_eq!(code(libc::ENOENT), "save_failed");
        assert!(save_error(&std::io::Error::from_raw_os_error(libc::EACCES), "/保存先").detail.unwrap_or_default().starts_with("/保存先: "));
    }

    /// 書き込めないフォルダに本当に保存したときに not_writable になる（保存と同じ関数で書く）
    #[cfg(unix)]
    #[test]
    fn saving_into_a_read_only_folder_is_not_writable() {
        use std::os::unix::fs::PermissionsExt;
        let base = std::env::temp_dir().join(format!("kikiwake-not-writable-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o555)).unwrap();
        let dir = base.join("録音_文字起こし");
        let files = vec![("transcript.md".to_string(), "本文\n".to_string())];
        let err = kikiwake_core::lines::write_files(&dir, &files, false).unwrap_err();
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o755)).unwrap();
        let _ = std::fs::remove_dir_all(&base);
        assert_eq!(save_error(&err, &dir.to_string_lossy()).code, "not_writable", "{err}");
    }
}
