//! 置き場所。モデル・作業フォルダ（履歴）・ログ・同梱したエンジン。
//! 作業用のファイルは同期フォルダ（Google ドライブ等）に置かない（Application Support は同期されない）。
use std::path::{Path, PathBuf};

use crate::error::AppError;

#[derive(Clone, Debug)]
pub struct Paths {
    /// モデル（~/Library/Application Support/Kikiwake/models）
    pub models: PathBuf,
    /// アプリのデータ（この Mac での処理の速さ・覚えた画面の言語など。~/Library/Application Support/Kikiwake）
    pub app_data: PathBuf,
    /// 作業フォルダ（jobs/<録音ごとの ID>/）の置き場所の親。~/Library/Application Support/Kikiwake。作業フォルダがそのまま履歴になる。
    /// 2026-09-27 に Caches から移した（macOS はディスクが足りないと Caches を消し、Time Machine にも入らないため）
    pub work: PathBuf,
    /// 前の置き場所（~/Library/Caches/Kikiwake）。そこに作業フォルダがあれば、開いたときに work へ移す（history.rs）。
    /// 確かめ用に KIKIWAKE_CACHE_DIR で置き場所を変えたときは無し（いつもの Kikiwake の作業フォルダを持ってこない）
    pub legacy_work: Option<PathBuf>,
    /// ログ（~/Library/Logs/Kikiwake。段階・時刻・エラーだけ。文字起こしの中身は書かない）
    pub logs: PathBuf,
    /// 同梱したエンジン（whisper-cli・kikiwake-diar・decode-avf）のあるフォルダ
    pub engines: PathBuf,
}

/// Tauri が同梱するエンジンの名前の後ろに付く目印（src-tauri/binaries/<名前>-<目印>）
pub const TARGET_TRIPLE: &str = "aarch64-apple-darwin";

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from)
}

impl Paths {
    /// Mac の既定の置き場所。確かめ用に環境変数で差し替えられる
    /// （KIKIWAKE_MODELS_DIR・KIKIWAKE_CACHE_DIR（作業フォルダ。名前は前のまま）・KIKIWAKE_ENGINES_DIR・KIKIWAKE_APP_DATA_DIR。
    /// 最後のものは操作役が、この Mac の速さの記録と覚えた画面の言語を、いつもの Kikiwake と分けるため）
    pub fn default_mac() -> Self {
        let lib = home().join("Library");
        let test_data = env_path("KIKIWAKE_APP_DATA_DIR");
        let app_data = test_data.clone().unwrap_or_else(|| lib.join("Application Support").join("Kikiwake"));
        let work = env_path("KIKIWAKE_CACHE_DIR");
        Self {
            models: env_path("KIKIWAKE_MODELS_DIR").unwrap_or_else(|| app_data.join("models")),
            app_data: app_data.clone(),
            work: work.clone().unwrap_or_else(|| app_data.clone()),
            // 確かめ用に置き場所を変えたときは、いつもの Kikiwake の作業フォルダを持ってこない
            legacy_work: (work.is_none() && test_data.is_none()).then(|| lib.join("Caches").join("Kikiwake")),
            logs: lib.join("Logs").join("Kikiwake"),
            engines: env_path("KIKIWAKE_ENGINES_DIR").unwrap_or_else(find_engines_dir),
        }
    }

    /// 作業フォルダ（＝履歴）の置き場所: ~/Library/Application Support/Kikiwake/jobs
    pub fn jobs(&self) -> PathBuf {
        self.work.join("jobs")
    }

    /// 同梱したエンジンの実行ファイル。.app の中は名前のまま、開発中は src-tauri/binaries/<名前>-<目印>
    pub fn engine(&self, name: &str) -> Result<PathBuf, AppError> {
        for p in [self.engines.join(name), self.engines.join(format!("{name}-{TARGET_TRIPLE}"))] {
            if p.is_file() {
                return Ok(p);
            }
        }
        Err(AppError::engine_failed().with_detail(format!("エンジンが見つからない: {name}（{}）", self.engines.display())))
    }
}

/// .app の中（Contents/MacOS に本体と並ぶ）→ 開発中の src-tauri/binaries（実行ファイルは src-tauri/target/<debug|release>/）の順に探す。
/// 作った Mac のフォルダの場所を実行ファイルに埋め込まないよう、実行ファイルの場所から数える
fn find_engines_dir() -> PathBuf {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default();
    if exe_dir.join("whisper-cli").is_file() {
        return exe_dir;
    }
    exe_dir.join("..").join("..").join("binaries")
}
