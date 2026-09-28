//! ファイルの確認（画面2）。対応している形式か・長さ・映像の有無・所要時間の目安・前回の結果。
use std::fs;
use std::path::Path;

use crate::engines;
use crate::error::AppError;
use crate::job::{default_out_dir, identify, load_speed, transcript_reusable, Engine, JobDir};
use crate::paths::Paths;
use crate::tidy::is_job_id;
use crate::types::{Estimate, FileInfo, Previous, PreviousChanged};

/// 対応している形式
pub const SUPPORTED: [&str; 5] = ["mp4", "mov", "m4a", "mp3", "wav"];

/// 所要時間の目安（全段階の合計）。Apple M4 で録音の長さの 0.2〜0.4 倍（Phase 0）。
/// この Mac で書き起こしたことがあれば、そのときの速さ（M4 の 68 分で 0.30 倍）との比で補正する
pub fn estimate(engine: &Engine, duration: f64) -> Estimate {
    let scale = load_speed(&engine.paths).map(|s| (s.transcribe_ratio / 0.30).clamp(0.5, 4.0)).unwrap_or(1.0);
    Estimate { min_sec: (duration * 0.2 * scale).round() as u64, max_sec: (duration * 0.4 * scale).round() as u64 }
}

pub fn inspect_file(engine: &Engine, path: &Path) -> Result<FileInfo, AppError> {
    let (id, src) = identify(path)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut fi = FileInfo {
        path: src.path.clone(),
        name,
        size_bytes: src.size_bytes,
        duration_sec: 0.0,
        has_video: false,
        supported: false,
        unsupported: None,
        estimate: Estimate { min_sec: 0, max_sec: 0 },
        previous: None,
        previous_changed: None,
    };
    if !SUPPORTED.contains(&ext.as_str()) {
        fi.unsupported = Some(AppError::unsupported_format());
        return Ok(fi);
    }
    match engines::inspect(&engine.paths, Path::new(&src.path)) {
        Ok(i) => {
            fi.duration_sec = kikiwake_core::pycompat::round(i.duration_sec, 2);
            fi.has_video = i.has_video;
            if !i.has_audio {
                fi.unsupported = Some(AppError::no_audio_track());
                return Ok(fi);
            }
        }
        Err(e) => {
            fi.unsupported = Some(e);
            return Ok(fi);
        }
    }
    fi.supported = true;
    fi.estimate = estimate(engine, fi.duration_sec);
    if let Ok(job) = JobDir::open(&engine.paths, &id) {
        if let Ok(old) = job.source() {
            // 版6: 前回の書き起こしまでそろっていれば、書き起こしをやり直さずに数秒で名前付けへ進む（4.5 時間の録音で実測 1.2 秒）。
            // 取り出した音声は使い終えたら消している（tidy.rs）ので、始めると元の録音から取り出し直す（68 分の録音で 1.2 秒）
            let result_reusable = transcript_reusable(&engine.paths, &job);
            if result_reusable {
                fi.estimate = Estimate { min_sec: 1, max_sec: 10 };
            }
            fi.previous = Some(Previous {
                out_dir: default_out_dir(Path::new(&src.path)).display().to_string(),
                diarization_reusable: job.diarization().is_file(),
                processed_at: old.processed_at,
                result_reusable,
            });
        }
    }
    if fi.previous.is_none() {
        fi.previous_changed = previous_changed(&engine.paths, &id, &src.path);
    }
    Ok(fi)
}

/// 版9: 同じ場所の録音を前に書き終えていて、そのあとファイルが変わった（大きさか更新日時が違うので別の録音＝別の ID になる）とき、
/// 前の録音を処理した日（いくつかあれば一番新しい日）。画面は「この場所の録音は、前に文字起こししています」と出す
pub fn previous_changed(paths: &Paths, id: &str, path: &str) -> Option<PreviousChanged> {
    fs::read_dir(paths.jobs())
        .ok()?
        .flatten()
        .filter_map(|e| {
            let other = e.file_name().to_string_lossy().into_owned();
            if other == id || !is_job_id(&other) {
                return None;
            }
            let src = JobDir::open(paths, &other).ok()?.source().ok()?;
            (src.path == path && src.status == "done").then_some(src.processed_at)
        })
        .max()
        .map(|processed_at| PreviousChanged { processed_at })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_an_earlier_recording_at_the_same_place() {
        // 版9: 同じ場所の録音を前に書き終えていて、そのあとファイルが変わった（別の ID）とき、前の処理日（一番新しい日）
        let root = std::env::temp_dir().join(format!("kikiwake-files-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let paths = Paths {
            models: root.join("models"),
            app_data: root.join("app"),
            work: root.join("work"),
            legacy_work: None,
            logs: root.join("logs"),
            engines: root.join("engines"),
        };
        let put = |id: &str, path: &str, status: &str, day: &str| {
            let dir = paths.jobs().join(id);
            fs::create_dir_all(&dir).unwrap();
            let src = serde_json::json!({"path": path, "sizeBytes": 10, "mtimeNs": 1, "durationSec": 60.0, "processedAt": day, "status": status});
            fs::write(dir.join("source.json"), src.to_string()).unwrap();
        };
        put("aaaa", "/x/定例.m4a", "done", "2026-09-20");
        put("bbbb", "/x/定例.m4a", "done", "2026-09-25");
        put("cccc", "/x/定例.m4a", "cancelled", "2026-09-26"); // 途中の録音は「文字起こしした」に数えない
        put("dddd", "/x/別.m4a", "done", "2026-09-27");
        let day = |id: &str, path: &str| previous_changed(&paths, id, path).map(|p| p.processed_at);
        assert_eq!(day("ffff", "/x/定例.m4a").as_deref(), Some("2026-09-25"));
        assert_eq!(day("bbbb", "/x/定例.m4a").as_deref(), Some("2026-09-20")); // 自分は数えない
        assert_eq!(day("ffff", "/x/無い.m4a"), None);
        let _ = fs::remove_dir_all(&root);
    }
}
