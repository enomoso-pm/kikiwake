//! 同梱した3つのエンジンの呼び出し。
//!   decode-avf    音声の取り出し（AVFoundation）と、ファイルの確認。版13 からマニュアルの素材の画面の絵（読み取りと書き出し）も
//!   kikiwake-diar 話者判定（NeMo-Speech.cpp の C の呼び出し口に WAV を少しずつ流し込む。4.5 時間でもメモリ 0.21GB）
//!   whisper-cli   書き起こし（whisper.cpp。Phase 0 で決めた設定。-mc 0 は必須）
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::paths::Paths;
use crate::proc::{self, Cancel, Finished};

pub const ASR_MODEL_FILE: &str = "ggml-large-v3.bin";
pub const DIAR_MODEL_FILE: &str = "Nemotron-3-Diarization.q8_0.gguf";

/// 書き起こしの設定（Phase 0 で採用）。-mc 0（文脈を引き継がない）が無いと、実録音 68 分が 16.7 分から同じ文の繰り返しで壊れた
pub const ASR_ARGS: [&str; 10] = ["-l", "ja", "-bs", "1", "--dtw", "large.v3", "-nfa", "-mc", "0", "-pp"];
/// 話者判定の設定（Phase 0 で採用。後処理は C++ の既定）
const DIAR_PRESET: &str = "v3-offline";

fn model(paths: &Paths, file: &str) -> Result<PathBuf, AppError> {
    let p = paths.models.join(file);
    if p.is_file() { Ok(p) } else { Err(AppError::model_missing().with_detail(p.display().to_string())) }
}

/// 動かせなかった・失敗した・中止された、を AppError に
fn check(name: &str, r: std::io::Result<Finished>) -> Result<Finished, AppError> {
    let f = match r {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => return Err(AppError::cancelled(false)),
        Err(e) => return Err(AppError::engine_failed().with_detail(format!("{name} を起動できない: {e}"))),
    };
    if f.cancelled {
        return Err(AppError::cancelled(false));
    }
    if f.killed_by_system() {
        return Err(AppError::out_of_memory().with_detail(f.detail(name)));
    }
    Ok(f)
}

// ---- decode-avf ----------------------------------------------------------------------

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspect {
    pub duration_sec: f64,
    pub has_audio: bool,
    pub has_video: bool,
}

fn decode_error(f: &Finished) -> AppError {
    match f.status.code() {
        Some(2) => AppError::unsupported_format().with_detail(f.detail("decode-avf")),
        Some(3) => AppError::no_audio_track().with_detail(f.detail("decode-avf")),
        _ => AppError::engine_failed().with_detail(f.detail("decode-avf")),
    }
}

/// ファイルの確認（長さ・音声と映像の有無）。開けない形式は unsupported_format
pub fn inspect(paths: &Paths, file: &Path) -> Result<Inspect, AppError> {
    let mut out = String::new();
    let args = [OsStr::new("inspect"), file.as_os_str()];
    let f = check("decode-avf", proc::run(&paths.engine("decode-avf")?, &args, &Cancel::new(), |l| out.push_str(l), |_| {}))?;
    if !f.status.success() {
        return Err(decode_error(&f));
    }
    serde_json::from_str(&out).map_err(|e| AppError::engine_failed().with_detail(format!("decode-avf inspect の出力: {e}")))
}

/// 16kHz・mono・16bit の WAV にする。返すのは長さ（秒）
pub fn decode(paths: &Paths, src: &Path, dst: &Path, cancel: &Cancel) -> Result<f64, AppError> {
    let mut out = String::new();
    let args = [OsStr::new("decode"), src.as_os_str(), dst.as_os_str()];
    let f = check("decode-avf", proc::run(&paths.engine("decode-avf")?, &args, cancel, |l| out.push_str(l), |_| {}))?;
    if !f.status.success() {
        return Err(decode_error(&f));
    }
    out.trim().parse().map_err(|_| AppError::engine_failed().with_detail(format!("decode-avf の出力: {out}")))
}

/// マニュアルの素材: 1 秒に 1 枚、小さな升の明るさと顔の位置を dst に書く（形は core の screens::SCAN_MAGIC）
pub fn frames_scan(paths: &Paths, src: &Path, dst: &Path, cancel: &Cancel) -> Result<(), AppError> {
    let args = [OsStr::new("frames-scan"), src.as_os_str(), dst.as_os_str()];
    let f = check("decode-avf", proc::run(&paths.engine("decode-avf")?, &args, cancel, |_| {}, |_| {}))?;
    match f.status.code() {
        Some(0) => Ok(()),
        Some(5) => Err(AppError::screens_unavailable().with_detail(f.detail("decode-avf frames-scan"))),
        _ => Err(decode_error(&f)),
    }
}

/// マニュアルの素材: 指示（spec.json の時刻・書き出す場所・黒く塗る四角）どおりに絵を PNG に書く
pub fn frames_export(paths: &Paths, src: &Path, spec: &Path, cancel: &Cancel) -> Result<(), AppError> {
    let args = [OsStr::new("frames-export"), src.as_os_str(), spec.as_os_str()];
    let f = check("decode-avf", proc::run(&paths.engine("decode-avf")?, &args, cancel, |_| {}, |_| {}))?;
    if f.status.success() { Ok(()) } else { Err(decode_error(&f)) }
}

// ---- kikiwake-diar -------------------------------------------------------------------

/// 話者判定。out_json は nemo-speech diarize --format json と同じ形。on_progress には 0〜100
pub fn diarize(
    paths: &Paths,
    wav: &Path,
    out_json: &Path,
    cancel: &Cancel,
    mut on_progress: impl FnMut(f64) + Send,
) -> Result<(), AppError> {
    let model = model(paths, DIAR_MODEL_FILE)?;
    let args: Vec<&std::ffi::OsStr> = vec![
        wav.as_os_str(), "--model".as_ref(), model.as_os_str(), "--preset".as_ref(), DIAR_PRESET.as_ref(),
        "--gpu".as_ref(), "0".as_ref(), "-o".as_ref(), out_json.as_os_str()];
    let f = check("kikiwake-diar", proc::run(&paths.engine("kikiwake-diar")?, &args, cancel, |_| {}, |l| {
        if let Some(p) = l.strip_prefix("progress ").and_then(|v| v.trim().parse::<f64>().ok()) {
            on_progress(p);
        }
    }))?;
    if !f.status.success() {
        return Err(AppError::engine_failed().with_detail(f.detail("kikiwake-diar")));
    }
    Ok(())
}

// ---- whisper-cli ---------------------------------------------------------------------

/// 「[00:01:02.340 --> 00:01:05.120]  文」→ (62.34, 65.12, "文")
pub fn parse_segment_line(line: &str) -> Option<(f64, f64, &str)> {
    let rest = line.strip_prefix('[')?;
    let (stamps, text) = rest.split_once(']')?;
    let (a, b) = stamps.split_once(" --> ")?;
    Some((parse_stamp(a.trim())?, parse_stamp(b.trim())?, text.trim()))
}

fn parse_stamp(s: &str) -> Option<f64> {
    let mut parts = s.split(':');
    let (h, m, sec) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    Some(h.parse::<f64>().ok()? * 3600.0 + m.parse::<f64>().ok()? * 60.0 + sec.parse::<f64>().ok()?)
}

/// 「whisper_print_progress_callback: progress =  45%」→ 45
pub fn parse_progress_line(line: &str) -> Option<f64> {
    let (_, v) = line.split_once("progress =")?;
    v.trim().strip_suffix('%')?.trim().parse().ok()
}

/// 書き起こし。out_stem.json（-ojf）を書いて、そのパスを返す。on_progress には 0〜100（whisper-cli の -pp。5% ごと）。
/// 標準出力の区切りは読まない（--dtw のとき whisper.cpp v1.9.4 の不具合で、書き始めの 1〜2 分だけ・重複して出る）
pub fn transcribe(
    paths: &Paths,
    wav: &Path,
    out_stem: &Path,
    cancel: &Cancel,
    mut on_progress: impl FnMut(f64) + Send,
) -> Result<PathBuf, AppError> {
    let model = model(paths, ASR_MODEL_FILE)?;
    let mut args: Vec<&std::ffi::OsStr> =
        vec!["-m".as_ref(), model.as_os_str(), "-f".as_ref(), wav.as_os_str(), "-ojf".as_ref(), "-of".as_ref(), out_stem.as_os_str()];
    args.extend(ASR_ARGS.iter().map(|a| std::ffi::OsStr::new(a)));
    let f = check("whisper-cli", proc::run(&paths.engine("whisper-cli")?, &args, cancel, |_| {}, |l| {
        if let Some(p) = parse_progress_line(l) {
            on_progress(p);
        }
    }))?;
    let json = PathBuf::from(format!("{}.json", out_stem.display())); // whisper-cli は -of の後ろに .json を付ける
    if !f.status.success() || !json.is_file() {
        return Err(AppError::engine_failed().with_detail(f.detail("whisper-cli")));
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_and_progress_lines() {
        assert_eq!(parse_segment_line("[00:01:02.340 --> 01:00:05.120]  はい"), Some((62.34, 3605.12, "はい")));
        assert_eq!(parse_segment_line("whisper_init: loading"), None);
        assert_eq!(parse_progress_line("whisper_print_progress_callback: progress =  45%"), Some(45.0));
        assert_eq!(parse_progress_line("whisper_print_progress_callback: progress = 100%"), Some(100.0));
        assert_eq!(parse_progress_line("progress 12"), None);
    }
}
