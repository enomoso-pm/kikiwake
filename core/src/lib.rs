//! Kikiwake のロジック。
//!
//! 移植元は Python 版（`merge.py`・`speakers.py`。公開していない）。
//! 同じ入力から一字一句同じ出力（transcript.md / transcript.json / speakers.md / speaker_hints.json）を作る。
//! 数値（0.3 秒・1.5 秒・90 秒など）は移植元の実測で決めたもの。変えるなら測ってから。

pub mod diar;
pub mod lang;
pub mod lines;
pub mod merge;
pub mod patterns;
pub mod pycompat;
pub mod pyjson;
pub mod repeat;
pub mod screens;
pub mod speakers;
pub mod unresolved;
pub mod view;
pub mod wav;
pub mod whisper;
