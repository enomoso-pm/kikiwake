//! 名前付けの画面（画面4）と結果の画面（画面5）。作業フォルダの一式から core で組み立てる。
//! 保存するファイルの書式は Python 版と同じ。名前は録音の名前入り（約束 版12。「定例会議_0926_文字起こし.md」）。
//! 同じ名前のファイルがあれば書かずに existing を返す。
use std::fs;
use std::path::{Path, PathBuf};

use kikiwake_core::lang::Lang;
use kikiwake_core::lines::{self, LineEdits, SaveFormat, SaveResult};
use kikiwake_core::merge::{self, Meta, Names, Turn, Word};
use kikiwake_core::unresolved::UnresolvedHint;
use kikiwake_core::view::{self, SpeakerCard, TranscriptView};
use kikiwake_core::{pyjson, wav};

use crate::error::{io_error, save_error, AppError};
use crate::job::{saved_stem, Engine, JobDir};
use crate::screens;
use crate::types::{RepeatNotice, SaveRequest, TranscriptOut};

fn load<T: serde::de::DeserializeOwned>(job: &JobDir, name: &str) -> Result<T, AppError> {
    merge::load_json(&job.file(name)).map_err(|e| io_error(&e, name))
}

struct Parts {
    words: Vec<Word>,
    turns: Vec<Turn>,
    meta: Meta,
}

fn parts(job: &JobDir) -> Result<Parts, AppError> {
    Ok(Parts { words: load(job, "words.json")?, turns: load(job, "diarization.json")?, meta: load(job, "meta.json")? })
}

/// 版4: 画面で知らせる繰り返し（突き合わせのときに repeat_notices.json に作ってある）
fn with_repeats(job: &JobDir, view: TranscriptView) -> TranscriptOut {
    let repeats: Vec<RepeatNotice> = merge::load_json(&job.file("repeat_notices.json")).unwrap_or_default();
    TranscriptOut { view, repeats }
}

/// 前に確定した名前（names.json。空なら無し）
pub(crate) fn names_of(job: &JobDir) -> Option<Names> {
    merge::load_json::<Names>(&job.file("names.json")).ok().filter(|n| !n.is_empty())
}

pub fn get_speakers(engine: &Engine, job_id: &str) -> Result<Vec<SpeakerCard>, AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    engine.set_viewing(job_id);
    load(&job, "speakers.json")
}

pub fn get_unresolved_hints(engine: &Engine, job_id: &str) -> Result<Vec<UnresolvedHint>, AppError> {
    load(&JobDir::open(&engine.paths, job_id)?, "unresolved_hints.json")
}

fn named_view(p: &Parts, names: &Names) -> TranscriptView {
    let named: Vec<lines::Line> = lines::lines(&p.words, &p.turns, Some(names), p.meta.speech_lang()).into_iter().map(|r| r.line).collect();
    let tt = merge::talk_time(&p.turns, Some(names));
    view::transcript_view(&named, &tt, &p.meta, p.meta.duration.unwrap_or(0.0), true)
}

/// 名前を確定する。names.json と実名版（Python 版と同じ transcript_named.md / .json）を作業フォルダに作り、実名版の行を返す。
/// 空の名前は付けていない扱い。行は名前でまとめない（id・区切りは名前付けの前と同じ）
pub fn apply_names(engine: &Engine, job_id: &str, names: &Names) -> Result<TranscriptOut, AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    engine.set_viewing(job_id);
    let p = parts(&job)?;
    let names = lines::clean_names(Some(names));
    fs::write(job.file("names.json"), pyjson::dumps(&names)).map_err(|e| io_error(&e, "names.json"))?;
    if names.is_empty() {
        return Ok(with_repeats(&job, load(&job, "view_transcript.json")?));
    }
    let dir = job.file("named");
    let _ = fs::remove_dir_all(&dir);
    // 作業フォルダの中の実名版は、画面の言語に関係なく Python 版と同じ日本語で
    let files =
        lines::save_files(&p.words, &p.turns, Some(&names), &LineEdits::default(), &p.meta, &[SaveFormat::Md, SaveFormat::Json], Lang::Ja);
    lines::write_files(&dir, &files, true).map_err(|e| io_error(&e, "実名版"))?;
    Ok(with_repeats(&job, named_view(&p, &names)))
}

/// 結果の行。named で名前が付いていれば実名版、そうでなければラベル版
pub fn get_transcript(engine: &Engine, job_id: &str, named: bool) -> Result<TranscriptOut, AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    engine.set_viewing(job_id);
    let view = match (named, names_of(&job)) {
        (true, Some(names)) => named_view(&parts(&job)?, &names),
        _ => load(&job, "view_transcript.json")?,
    };
    Ok(with_repeats(&job, view))
}

/// 手直しを当てて保存する。同じ名前のファイルがあれば、overwrite でない限り書かずに existing を返す。
/// 中の言葉は画面の言語（約束 版7。英語なら見出し・確認用の欄・「Speaker A」を英語に）。
/// ファイルの名前は録音の名前入り（約束 版12。中身は core が作る Python 版と同じもので、名前だけ付け替える）。
/// 版13: screens ならマニュアルの素材の zip も（「<元の名前>_マニュアル素材.zip」。formats が空なら zip だけ）。
/// zip が作れない（元の録画が無い など）ときは、何も書かずにエラーを返す
pub fn save_outputs(engine: &Engine, job_id: &str, req: &SaveRequest) -> Result<SaveResult, AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    let p = parts(&job)?;
    let names = names_of(&job);
    let edits = req.edits.clone().unwrap_or_default();
    let zip = req.screens.unwrap_or(false);
    let formats: Vec<SaveFormat> = if req.formats.is_empty() && !zip { vec![SaveFormat::Md] } else { req.formats.clone() };
    let lang = engine.locale();
    let source = PathBuf::from(&job.source()?.path);
    let stem = saved_stem(&source, lang);
    let files: Vec<(String, String)> = lines::save_files(&p.words, &p.turns, names.as_ref(), &edits, &p.meta, &formats, lang)
        .into_iter()
        .map(|(name, body)| (renamed(&name, &stem), body))
        .collect();
    let dir = Path::new(&req.dir);
    let zip_path = zip.then(|| dir.join(screens::zip_name(&source, lang)));
    if !req.overwrite.unwrap_or(false) {
        let mut existing: Vec<String> =
            files.iter().map(|(n, _)| dir.join(n)).filter(|p| p.exists()).map(|p| p.display().to_string()).collect();
        existing.extend(zip_path.iter().filter(|z| z.exists()).map(|z| z.display().to_string()));
        if !existing.is_empty() {
            return Ok(SaveResult { files: Vec::new(), existing });
        }
    }
    if zip {
        screens::check_ready(&job)?;
    }
    let mut res = lines::write_files(dir, &files, true).map_err(|e| save_error(&e, &req.dir))?;
    if let Some(z) = zip_path {
        let zp = screens::ZipParts { words: &p.words, turns: &p.turns, names: names.as_ref(), edits: &edits, meta: &p.meta };
        screens::write_zip(&engine.paths, &job, &zp, lang, &z)?;
        res.files.push(z.display().to_string());
    }
    Ok(res)
}

/// 「transcript_named.md」→「<stem>.md」（拡張子はそのまま）
fn renamed(name: &str, stem: &str) -> String {
    match Path::new(name).extension() {
        Some(ext) => format!("{stem}.{}", ext.to_string_lossy()),
        None => stem.to_string(),
    }
}

/// 録音の start〜end 秒を切り出した WAV（結果の画面の行の再生）。同じ範囲は前に作ったものを使う。
/// 取り出した音声が掃除で消えていたら（別の録音を始めた・開いた）、元ファイルから取り出し直す（68 分の録音で 1.2 秒）
pub fn recording_clip(engine: &Engine, job_id: &str, start: f64, end: f64) -> Result<PathBuf, AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    engine.set_viewing(job_id);
    let dur = job.source()?.duration_sec;
    let (s, e) = (start.max(0.0), end.min(if dur > 0.0 { dur } else { end }));
    if !(e > s) {
        return Err(AppError::engine_failed().with_detail(format!("再生する範囲が正しくない: {start}〜{end}")));
    }
    let dir = job.file("clips");
    fs::create_dir_all(&dir).map_err(|er| io_error(&er, "clips"))?;
    let dst = dir.join(format!("{}_{}.wav", (s * 1000.0).round() as u64, (e * 1000.0).round() as u64));
    if !dst.is_file() {
        if !crate::history::ensure_audio(engine, &job) {
            return Err(AppError::file_not_found().with_detail("元ファイルが無い・変わったので、行を再生できない"));
        }
        wav::cut(&job.audio(), s, e, &dst, 0.0, e - s).map_err(|er| io_error(&er, "行の再生"))?;
    }
    Ok(dst)
}

/// Finder で表示する
pub fn reveal_in_file_manager(path: &Path) -> Result<(), AppError> {
    // 絶対パスだけ（「-」で始まる値が open の指定として読まれないように）
    if !path.is_absolute() || !path.exists() {
        return Err(AppError::file_not_found().with_detail(path.display().to_string()));
    }
    let arg = if path.is_dir() { "" } else { "-R" };
    let mut cmd = std::process::Command::new("/usr/bin/open");
    if !arg.is_empty() {
        cmd.arg(arg);
    }
    cmd.arg(path).status().map_err(|e| io_error(&e, "Finder"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_files_take_the_recording_name() {
        // 約束 版12: core が作る Python 版の名前（中身はそのまま）を、録音の名前入りに付け替える
        assert_eq!(renamed("transcript_named.md", "定例会議_0926_文字起こし"), "定例会議_0926_文字起こし.md");
        assert_eq!(renamed("transcript.json", "定例会議_0926_文字起こし"), "定例会議_0926_文字起こし.json");
        assert_eq!(renamed("transcript_named.txt", "Weekly_transcript"), "Weekly_transcript.txt");
    }
}
