//! Kikiwake の処理の流れ。画面（Tauri の外枠 src-tauri/src）から呼ぶ。Tauri には頼らない（画面なしでも確かめられるように）。
//!
//! 受け渡しの約束（contract/api.ts の KikiwakeApi）の関数を、ここの関数で埋める。
//! ロジック（突き合わせ・話者カード・保存の書式）は core（Phase 1 で Rust に移植。Python 版と一字一句同じ）を使う。

pub mod engines;
pub mod env;
pub mod error;
pub mod files;
pub mod history;
pub mod job;
pub mod log;
pub mod models;
pub mod paths;
pub mod proc;
pub mod results;
pub mod screens;
pub mod tidy;
pub mod types;
pub mod update;
pub mod zip;

pub use error::AppError;
pub use job::Engine;
pub use paths::Paths;
