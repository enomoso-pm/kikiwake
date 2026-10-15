//! マニュアルの素材（画面の絵。2026-10-12 決定）。
//!
//! 録画（映像のあるファイル）で「マニュアル用に、画面の絵も取り出す」を選んで文字起こしすると、文字起こしと同時に
//! decode-avf frames-scan で 1 秒に 1 枚を読み、core の screens で区間を決めて作業フォルダの screens.json に置く（数十 KB）。
//! 読み取りの途中のデータ（1 時間で約 50MB）は判定のあと消す（環境変数 KIKIWAKE_KEEP_SCAN=1 なら残す。数値を変えて試すとき。
//! core の kikiwake-dev screens で判定し直せる）。
//! 絵そのものは、保存のとき（「保存…」で「マニュアルの素材（.zip）」を選んだとき）に元の録画から取り出す。
//! 行の再生と同じく、元の録画を移したり書き換えたりしたら作れない。
//! 判定の版（core の SCREENS_VERSION）が上がると、前の版の結果は使わない。保存の窓には「読み取り直しが要る」（screens_outdated）と出し、
//! 新しい録音として選び直すと、文字起こしは使い回して画面だけ読み取り直す。
//! zip の中身: README.md（AI への頼みごと）・timeline.md / timeline.json（区間ごとの絵と発言）・transcript.md（保存する .md と同じ）・
//! frames/*.jpg（会議アプリの参加者の枠などを外し、共有した画面の部分だけを切り出したもの。見分けられなかった絵は録画の全体）
use std::fs;
use std::path::Path;

use kikiwake_core::lang::Lang;
use kikiwake_core::lines::{self, LineEdits, SaveFormat};
use kikiwake_core::merge::{Meta, Names, Turn, Word};
use kikiwake_core::screens::{self as core, Scan, Screens, ScreensConfig, SCREENS_VERSION};
use serde::{Deserialize, Serialize};

use crate::engines;
use crate::error::{io_error, save_error, AppError};
use crate::history::source_state;
use crate::job::JobDir;
use crate::paths::Paths;
use crate::proc::Cancel;
use crate::types::SourceState;

/// 「マニュアル用に、画面の絵も取り出す」を選んで始めた録音の印（中止して続きから始めたときも読み取る）
const WANTED: &str = "screens_wanted";
/// 読み取りの途中のデータ（判定のあと消す）
pub const SCAN: &str = "screens_scan.bin";
/// 判定の結果
pub const RESULT: &str = "screens.json";
/// 判定に使った形の版と数値（変わっていたら、次に選んで始めたときに読み取りからやり直す）
const SETTINGS: &str = "screens_settings.json";
/// 読み取れなかったときのエラー
const FAILED: &str = "screens_error.json";
/// 保存のときの絵（zip にしたら消す）
pub const EXPORT: &str = "screens_export";
/// 書き出す絵の横幅の上限（4K の画面録画でも zip が重くなりすぎないように）
const MAX_WIDTH: u32 = 1920;

/// 画面に出す数（contract の ScreensInfo。JobDone.screens）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreensInfo {
    /// 絵の枚数（zip に入る）。0 なら zip は作れない（画面の共有が見つからなかった）
    pub frames: usize,
    pub scenes: usize,
    pub steps: usize,
    /// 顔が写っているかもしれない絵
    pub faces: usize,
    /// 録画を読み取れなかった
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

/// マニュアル用に始めた（印を付ける）
pub fn mark_wanted(job: &JobDir) {
    let _ = fs::write(job.file(WANTED), b"");
}

/// 前にマニュアル用で始めた録音か（続きから始めたときに、画面の読み取りも続ける）
pub fn wanted(job: &JobDir) -> bool {
    job.file(WANTED).is_file()
}

fn settings() -> String {
    serde_json::json!({ "version": SCREENS_VERSION, "config": ScreensConfig::default() }).to_string()
}

/// 前の判定の結果がそのまま使える（同じ形の版・同じ数値）
pub fn reusable(job: &JobDir) -> bool {
    load(job).is_some() && fs::read_to_string(job.file(SETTINGS)).ok().as_deref() == Some(settings().as_str())
}

/// 判定の結果（無い・読めない・形の版が違うときは None）
pub fn load(job: &JobDir) -> Option<Screens> {
    let s: Screens = serde_json::from_str(&fs::read_to_string(job.file(RESULT)).ok()?).ok()?;
    (s.version == SCREENS_VERSION).then_some(s)
}

/// 前の版で読み取った（判定の版が違う結果がある）。そのままでは zip を作れないので、読み取り直しが要ると知らせる
/// （2026-10-16。前は「マニュアル用にしていない録音」と同じに扱い、保存の窓に zip の行が理由なしに出なかった）
fn outdated(job: &JobDir) -> bool {
    let Ok(text) = fs::read_to_string(job.file(RESULT)) else {
        return false;
    };
    let v: Option<u64> = serde_json::from_str::<serde_json::Value>(&text).ok().and_then(|j| j.get("version")?.as_u64());
    v.is_some_and(|v| v != u64::from(SCREENS_VERSION))
}

fn info_of(s: &Screens) -> ScreensInfo {
    let m = &s.summary;
    ScreensInfo { frames: m.frames, scenes: m.scenes, steps: m.steps, faces: m.faces, error: None }
}

/// 画面に出す数。マニュアル用にしていない録音は None。
/// 読み取れなかった（いちばん新しい読み取りの失敗）・前の版で読み取った（screens_outdated）ときは、絵 0 枚とその理由
pub fn info(job: &JobDir) -> Option<ScreensInfo> {
    if let Some(s) = load(job) {
        return Some(info_of(&s));
    }
    let failed = fs::read_to_string(job.file(FAILED)).ok().and_then(|t| serde_json::from_str::<AppError>(&t).ok());
    let e = failed.or_else(|| outdated(job).then(AppError::screens_outdated))?;
    Some(ScreensInfo { frames: 0, scenes: 0, steps: 0, faces: 0, error: Some(e) })
}

/// 読み取って判定し、screens.json に置く（文字起こしと同時に、別のスレッドで動かす）。
/// 失敗しても文字起こしは止めない（中止のほかは screens_error.json に残し、画面に出す）
pub fn run(paths: &Paths, job: &JobDir, source: &Path, cancel: &Cancel) -> Result<ScreensInfo, AppError> {
    let r = scan_and_analyze(paths, job, source, cancel);
    match &r {
        Ok(_) => {
            let _ = fs::remove_file(job.file(FAILED));
        }
        Err(e) if !e.is_cancelled() => {
            let _ = fs::write(job.file(FAILED), serde_json::to_string(e).unwrap_or_default());
        }
        Err(_) => {}
    }
    if std::env::var("KIKIWAKE_KEEP_SCAN").as_deref() != Ok("1") {
        let _ = fs::remove_file(job.file(SCAN));
    }
    r
}

fn scan_and_analyze(paths: &Paths, job: &JobDir, source: &Path, cancel: &Cancel) -> Result<ScreensInfo, AppError> {
    let scan_path = job.file(SCAN);
    engines::frames_scan(paths, source, &scan_path, cancel)?;
    let bytes = fs::read(&scan_path).map_err(|e| io_error(&e, SCAN))?;
    let scan = Scan::from_bytes(&bytes).map_err(|e| AppError::engine_failed().with_detail(e))?;
    let sc = core::analyze(&scan, &ScreensConfig::default());
    let tmp = job.file("screens.json.part");
    let body = serde_json::to_string_pretty(&sc).unwrap_or_default();
    fs::write(&tmp, body).and_then(|_| fs::rename(&tmp, job.file(RESULT))).map_err(|e| io_error(&e, RESULT))?;
    fs::write(job.file(SETTINGS), settings()).map_err(|e| io_error(&e, SETTINGS))?;
    Ok(info_of(&sc))
}

/// zip の名前: 「<元の名前>_マニュアル素材.zip」（英語の画面では「<名前>_manual_materials.zip」）
pub fn zip_name(source: &Path, lang: Lang) -> String {
    let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    match lang {
        Lang::Ja => format!("{stem}_マニュアル素材.zip"),
        Lang::En => format!("{stem}_manual_materials.zip"),
    }
}

/// AI への頼みごと（zip の README.md）
pub fn readme(lang: Lang) -> &'static str {
    match lang {
        Lang::Ja => include_str!("../assets/manual_readme_ja.md"),
        Lang::En => include_str!("../assets/manual_readme_en.md"),
    }
}

/// zip を作れるか（今の版で読み取った絵が 1 枚以上ある・元の録画が同じ場所にそのままある）。作れるなら判定の結果を返す
pub fn check_ready(job: &JobDir) -> Result<Screens, AppError> {
    let Some(sc) = load(job) else {
        return Err(if outdated(job) { AppError::screens_outdated() } else { AppError::screens_unavailable() });
    };
    if sc.summary.frames == 0 {
        return Err(AppError::screens_unavailable());
    }
    if source_state(job) != SourceState::Ok {
        return Err(AppError::screens_source_missing());
    }
    Ok(sc)
}

/// zip を作る材料（保存する .md と同じもの）
pub struct ZipParts<'a> {
    pub words: &'a [Word],
    pub turns: &'a [Turn],
    pub names: Option<&'a Names>,
    pub edits: &'a LineEdits,
    pub meta: &'a Meta,
}

/// マニュアルの素材の zip を dest に書く（保存の「マニュアルの素材（.zip）」）。
/// 絵は元の録画から取り出し（作業フォルダの screens_export に一時的に置き、zip にしたら消す）、カメラの四角を黒く塗る
pub fn write_zip(paths: &Paths, job: &JobDir, parts: &ZipParts, lang: Lang, dest: &Path) -> Result<(), AppError> {
    let sc = check_ready(job)?;
    let src = job.source()?;
    let tmp = job.file(EXPORT);
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| io_error(&e, EXPORT))?;
    let result = (|| {
        // 1. 絵を取り出す
        let shots: Vec<(String, std::path::PathBuf)> = sc
            .spans
            .iter()
            .filter_map(|s| s.frame.as_ref().map(|f| (f.clone(), tmp.join(f.trim_start_matches("frames/")))))
            .collect();
        // 塗る四角は、切り出した絵に対する割合で渡す（decode-avf は切り出してから塗る）
        let items: Vec<serde_json::Value> = sc
            .spans
            .iter()
            .filter(|s| s.frame.is_some())
            .zip(&shots)
            .map(|(s, (_, out))| {
                let shown = core::in_image_span(s);
                serde_json::json!({ "t": s.frame_t.unwrap_or(0.0), "out": out, "crop": s.crop, "masks": shown.masks })
            })
            .collect();
        let spec = tmp.join("spec.json");
        fs::write(&spec, serde_json::json!({ "maxWidth": MAX_WIDTH, "items": items }).to_string()).map_err(|e| io_error(&e, "spec.json"))?;
        engines::frames_export(paths, Path::new(&src.path), &spec, &Cancel::new())?;
        // 2. 文書（timeline・保存する .md と同じ文字起こし・README）
        let utts = lines::saved_utterances(parts.words, parts.turns, parts.names, parts.edits);
        let title = parts.meta.title.clone().unwrap_or_default();
        let transcript = lines::save_files(parts.words, parts.turns, parts.names, parts.edits, parts.meta, &[SaveFormat::Md], lang)
            .into_iter()
            .next()
            .map(|(_, body)| body)
            .unwrap_or_default();
        let mut entries: Vec<(String, Vec<u8>)> = vec![
            ("README.md".into(), readme(lang).as_bytes().to_vec()),
            ("timeline.md".into(), core::timeline_md(&sc, &utts, &title, lang).into_bytes()),
            ("timeline.json".into(), core::timeline_json(&sc, &utts, &title, lang).into_bytes()),
            ("transcript.md".into(), transcript.into_bytes()),
        ];
        for (name, path) in &shots {
            entries.push((name.clone(), fs::read(path).map_err(|e| io_error(&e, name))?));
        }
        // 3. zip（書きかけの名前で書いてから付け替える。途中で止まっても半端な zip を残さない）
        let dir = dest.parent().unwrap_or(Path::new("/"));
        let part = dest.with_extension("zip.part");
        crate::zip::write(&part, &entries).map_err(|e| save_error(&e, &dir.display().to_string()))?;
        fs::rename(&part, dest).map_err(|e| save_error(&e, &dir.display().to_string()))
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_job(name: &str) -> JobDir {
        let dir = std::env::temp_dir().join(format!("kikiwake-screens-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        JobDir { id: "abcd".into(), dir }
    }

    #[test]
    fn zip_takes_the_recording_name_and_the_screen_language() {
        assert_eq!(zip_name(Path::new("/x/定例会議_0926.mp4"), Lang::Ja), "定例会議_0926_マニュアル素材.zip");
        assert_eq!(zip_name(Path::new("/x/Weekly.mov"), Lang::En), "Weekly_manual_materials.zip");
        // AI への頼みごとは「読み方」と「書き方」の 2 部
        assert!(readme(Lang::Ja).contains("## AI の方へ（1）この zip の読み方"));
        assert!(readme(Lang::Ja).contains("## AI の方へ（2）マニュアルの書き方"));
        assert!(readme(Lang::En).contains("## For the AI (2): how to write the manual"));
    }

    #[test]
    fn a_zip_needs_images_and_the_original_recording() {
        let job = tmp_job("ready");
        // 判定の結果が無い（マニュアル用にしていない）
        assert_eq!(check_ready(&job).unwrap_err().code, "screens_unavailable");
        assert_eq!(info(&job), None);
        // 絵が 0 枚（画面の共有が見つからなかった）
        let mut sc = core::analyze(
            &Scan { video_w: 64, video_h: 36, sig_w: 4, sig_h: 2, frames: Vec::new() },
            &ScreensConfig::default(),
        );
        fs::write(job.file(RESULT), serde_json::to_string(&sc).unwrap()).unwrap();
        assert_eq!(check_ready(&job).unwrap_err().code, "screens_unavailable");
        // 絵はあるが、元の録画が無い
        sc.summary.frames = 2;
        fs::write(job.file(RESULT), serde_json::to_string(&sc).unwrap()).unwrap();
        let src = serde_json::json!({"path": "/無い/録画.mp4", "sizeBytes": 10, "mtimeNs": 1, "durationSec": 60.0, "processedAt": "2026-10-12", "status": "done"});
        fs::write(job.file("source.json"), src.to_string()).unwrap();
        assert_eq!(check_ready(&job).unwrap_err().code, "screens_source_missing");
        assert_eq!(info(&job).map(|i| i.frames), Some(2));
        // 読み取れなかったときは、エラーを画面に出す
        fs::remove_file(job.file(RESULT)).unwrap();
        fs::write(job.file(FAILED), serde_json::to_string(&AppError::screens_unavailable()).unwrap()).unwrap();
        assert_eq!(info(&job).and_then(|i| i.error).map(|e| e.code), Some("screens_unavailable".to_string()));
        let _ = fs::remove_dir_all(&job.dir);
    }

    /// 前の版で読み取った録画（判定の版が上がった）: 保存の窓に「読み取り直しが要る」と出し、次に始めたら読み取り直す（2026-10-16）
    #[test]
    fn a_result_from_an_earlier_version_asks_to_read_again() {
        let job = tmp_job("outdated");
        let mut sc = core::analyze(
            &Scan { video_w: 64, video_h: 36, sig_w: 4, sig_h: 2, frames: Vec::new() },
            &ScreensConfig::default(),
        );
        sc.version = SCREENS_VERSION - 1;
        sc.summary.frames = 2;
        fs::write(job.file(RESULT), serde_json::to_string(&sc).unwrap()).unwrap();
        // 判定の数値の控えが今と同じでも、結果が前の版なら使い回さない
        fs::write(job.file(SETTINGS), settings()).unwrap();
        assert!(!reusable(&job));
        let i = info(&job).unwrap();
        assert_eq!((i.frames, i.error.map(|e| e.code)), (0, Some("screens_outdated".to_string())));
        assert_eq!(check_ready(&job).unwrap_err().code, "screens_outdated");
        // 読み取り直して失敗したら、その失敗を出す（前の版の結果は残っている）
        fs::write(job.file(FAILED), serde_json::to_string(&AppError::screens_unavailable()).unwrap()).unwrap();
        assert_eq!(info(&job).and_then(|i| i.error).map(|e| e.code), Some("screens_unavailable".to_string()));
        fs::remove_file(job.file(FAILED)).unwrap();
        // 今の版で読み取り直したら、使い回せて数が出る
        sc.version = SCREENS_VERSION;
        fs::write(job.file(RESULT), serde_json::to_string(&sc).unwrap()).unwrap();
        assert!(reusable(&job));
        assert_eq!(info(&job).map(|i| (i.frames, i.error.is_none())), Some((2, true)));
        // 読めない screens.json は、前の版とはみなさない（マニュアル用にしていない録音と同じ）
        fs::write(job.file(RESULT), "{").unwrap();
        assert_eq!(info(&job), None);
        let _ = fs::remove_dir_all(&job.dir);
    }
}
