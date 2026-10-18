//! 履歴（2026-09-27 決定）: 過去に文字起こしした録音を一覧から開き直す・手で消す。
//!
//! 作業フォルダ（jobs/<録音ごとの ID>/）がそのまま履歴になる。置き場所は ~/Library/Application Support/Kikiwake/jobs/。
//! 前は ~/Library/Caches/Kikiwake/jobs/ だった（macOS はディスクが足りないと Caches を消し、Time Machine にも入らない）ので、
//! アプリを開いたときに移す（1回だけ。移すものが無くなれば何もしない）。
//!
//! 元の録音・録画（利用者のファイル）と、保存先に保存した文字起こしのファイルには触らない（tidy.rs と同じ原則）。
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use sha2::{Digest, Sha256};

use crate::engines;
use crate::error::{io_error, AppError};
use crate::job::{default_out_dir, identify, Engine, JobDir};
use crate::paths::Paths;
use crate::results::names_of;
use crate::tidy::{self, is_job_id, last_used, remove, size_of};
use crate::types::{HistoryItem, HistoryOpened, HistoryStatus, JobDone, NamedSpeakers, SourceState};

// ---- 閉じたときの状態（約束 版8 の JobDraft） --------------------------------------------------

/// 閉じたときの状態を置くファイル（作業フォルダの中）
const DRAFT_FILE: &str = "draft.json";
/// 閉じたときの状態の大きさの上限（4 時間・1,500 行を全部直しても数百 KB）
const DRAFT_MAX_BYTES: usize = 20_000_000;

/// 書き起こし（結果の画面の行）の指紋。行の id はこれが同じ間だけ変わらない
fn view_basis(job: &JobDir) -> Option<String> {
    let bytes = fs::read(job.file("view_transcript.json")).ok()?;
    Some(Sha256::digest(&bytes).iter().take(8).map(|b| format!("{b:02x}")).collect())
}

/// 閉じたときの状態を書く（画面が変わるたびに呼ぶ）。中身は画面が決める（エンジンは見ない）。
/// 行の id に結びつくので、そのときの書き起こしの指紋と一緒に置く
pub fn save_draft(engine: &Engine, job_id: &str, draft: &serde_json::Value) -> Result<(), AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    let basis = view_basis(&job);
    let text = serde_json::to_string(&serde_json::json!({ "basis": basis, "draft": draft }))
        .map_err(|e| AppError::engine_failed().with_detail(format!("draft.json: {e}")))?;
    if text.len() > DRAFT_MAX_BYTES {
        return Err(AppError::engine_failed().with_detail(format!("閉じたときの状態が大きすぎる（{} バイト）", text.len())));
    }
    let tmp = job.file("draft.part");
    fs::write(&tmp, text).and_then(|_| fs::rename(&tmp, job.file(DRAFT_FILE))).map_err(|e| io_error(&e, DRAFT_FILE))
}

/// 閉じたときの状態。書き起こしが変わっていたら（行の id が合わないので）使わない
pub fn load_draft(job: &JobDir) -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(job.file(DRAFT_FILE)).ok()?).ok()?;
    let basis = v.get("basis").and_then(|b| b.as_str()).map(str::to_string);
    if basis.is_none() || basis != view_basis(job) {
        return None;
    }
    v.get("draft").filter(|d| d.is_object()).cloned()
}

// ---- 履歴の一覧・開く・消す・選び直す --------------------------------------------------------

/// 結果の一式がそろっている（書き終えた）か。途中で閉じた・中止した・止まった録音は false
fn finished(job: &JobDir) -> bool {
    job.source().is_ok_and(|s| s.status == "done")
        && ["view_transcript.json", "words.json", "diarization.json", "meta.json", "speakers.json"].iter().all(|f| job.file(f).is_file())
}

/// 元ファイルの状態（版9）。同じ場所・大きさ・更新日時のファイルがある（つまり同じ ID になる）なら ok、
/// 場所にファイルが無ければ missing、あるが大きさか更新日時が違えば changed（編集した・書き出し直した・コピーし直した・クラウドの同期）
pub(crate) fn source_state(job: &JobDir) -> SourceState {
    let Ok(src) = job.source() else { return SourceState::Missing };
    let path = Path::new(&src.path);
    if !path.is_file() {
        return SourceState::Missing;
    }
    match identify(path) {
        Ok((id, _)) if id == job.id => SourceState::Ok,
        Ok(_) => SourceState::Changed,
        Err(_) => SourceState::Missing,
    }
}

/// 行の再生に使う音声（audio.wav）を用意する。無ければ元ファイルから取り出す（68 分の録音で 1.2 秒）。
/// 元ファイルが無い・変わった・取り出せないときは false（書き起こしは読めるが、行の再生はできない）
pub(crate) fn ensure_audio(engine: &Engine, job: &JobDir) -> bool {
    let _one = engine.audio_lock.lock().unwrap_or_else(|e| e.into_inner());
    if job.audio().is_file() {
        return true;
    }
    if source_state(job) != SourceState::Ok {
        return false;
    }
    let Ok(src) = job.source() else { return false };
    let tmp = job.file("audio.part.wav");
    let cancel = crate::proc::Cancel::new();
    match engines::decode(&engine.paths, Path::new(&src.path), &tmp, &cancel)
        .and_then(|_| fs::rename(&tmp, job.audio()).map_err(|e| io_error(&e, "audio.wav")))
    {
        Ok(()) => {
            crate::log::write(&engine.paths, &format!("job {} 行の再生のために音声を取り出した", job.id));
            true
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            crate::log::write(&engine.paths, &format!("job {} 音声を取り出せない {e}", job.id));
            false
        }
    }
}

/// 閉じたときの状態の中身を、書き起こしの指紋を見ずに読む（保存したこと・保存したファイルは、書き起こしが変わっても変わらないため）
fn raw_draft(job: &JobDir) -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(job.file(DRAFT_FILE)).ok()?).ok()?;
    v.get("draft").cloned()
}

/// 文字列の並び（空・文字でないものは無い扱い）
fn strings_of(d: &serde_json::Value, key: &str) -> Option<Vec<String>> {
    let list: Vec<String> = d.get(key)?.as_array()?.iter().filter_map(|x| x.as_str().map(str::to_string)).collect();
    (!list.is_empty()).then_some(list)
}

/// 文字起こしをファイルに保存したことがあるか（版9）。閉じたときの状態の savedOnce（前の版の状態は savedFiles）で見る
fn saved_once(job: &JobDir) -> bool {
    let Some(d) = raw_draft(job) else { return false };
    d.get("savedOnce").and_then(|b| b.as_bool()) == Some(true) || strings_of(&d, "savedFiles").is_some()
}

/// 最後に保存したファイル（版12）。閉じたときの状態の lastSavedFiles（保存したあとで名前を変えても残る）。
/// 前の版の状態は savedFiles で見る。一度も保存していなければ None（一覧の行の「…」の「Finder で表示」に使う）
fn last_saved_files(job: &JobDir) -> Option<Vec<String>> {
    let d = raw_draft(job)?;
    strings_of(&d, "lastSavedFiles").or_else(|| strings_of(&d, "savedFiles"))
}

/// 付けた名前（版9）。同じ名前を付けた話者は1人にまとめ、発言の多い順（保存するファイルの発言時間と同じ数え方）。
/// 名前を確定していなければ None
fn named_speakers(job: &JobDir) -> Option<NamedSpeakers> {
    let names = names_of(job)?;
    let named: std::collections::HashSet<&str> = names.values().map(String::as_str).filter(|v| !v.trim().is_empty()).collect();
    let turns: Vec<kikiwake_core::merge::Turn> = kikiwake_core::merge::load_json(&job.diarization()).ok()?;
    let mut out = NamedSpeakers { names: Vec::new(), unnamed: 0 };
    for (who, _) in kikiwake_core::merge::talk_time(&turns, Some(&names)) {
        if named.contains(who.as_str()) {
            out.names.push(who);
        } else {
            out.unnamed += 1;
        }
    }
    (!out.names.is_empty()).then_some(out)
}

/// 最後に使った日時（処理・名前の確定・手直しのどれか）。一覧の並びに使う
fn last_touched(job: &JobDir) -> SystemTime {
    ["names.json", DRAFT_FILE]
        .iter()
        .filter_map(|f| fs::metadata(job.file(f)).and_then(|m| m.modified()).ok())
        .chain(last_used(&job.dir))
        .max()
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn count_speakers(job: &JobDir) -> Option<usize> {
    if let Ok(cards) = kikiwake_core::merge::load_json::<Vec<serde_json::Value>>(&job.file("speakers.json")) {
        return Some(cards.len());
    }
    let turns: Vec<kikiwake_core::merge::Turn> = kikiwake_core::merge::load_json(&job.diarization()).ok()?;
    Some(kikiwake_core::merge::label_map(&turns).len())
}

/// 履歴の一覧（最後に使った順）。書き終えた録音と、途中の録音（中止・止まった・処理中に閉じた）の両方を出す（2026-09-27 決定）。
/// いま処理中の録音は出さない
pub fn list_history(engine: &Engine) -> Vec<HistoryItem> {
    let running = engine.running_id();
    let Ok(rd) = fs::read_dir(engine.paths.jobs()) else {
        return Vec::new();
    };
    let mut items: Vec<(SystemTime, HistoryItem)> = Vec::new();
    for e in rd.flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        if !is_job_id(&id) || running.as_deref() == Some(id.as_str()) {
            continue;
        }
        let Ok(job) = JobDir::open(&engine.paths, &id) else { continue };
        let Ok(src) = job.source() else { continue };
        let done = finished(&job);
        let unsaved = load_draft(&job).is_some_and(|d| d.get("unsaved").and_then(|u| u.as_bool()) == Some(true));
        let name = Path::new(&src.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let state = source_state(&job);
        let item = HistoryItem {
            job_id: id,
            name,
            path: src.path.clone(),
            duration_sec: src.duration_sec,
            processed_at: src.processed_at.clone(),
            status: if done { HistoryStatus::Done } else { HistoryStatus::Unfinished },
            speakers: count_speakers(&job),
            named: names_of(&job).is_some(),
            unsaved_edits: done && unsaved,
            source_available: state == SourceState::Ok,
            diarization_kept: job.diarization().is_file(),
            source_state: state,
            saved: done && saved_once(&job),
            named_speakers: named_speakers(&job),
            saved_files: if done { last_saved_files(&job) } else { None },
            language: crate::job::transcript_language(&job).map(|s| s.language),
        };
        items.push((last_touched(&job), item));
    }
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.job_id.cmp(&b.1.job_id)));
    items.into_iter().map(|(_, i)| i).collect()
}

/// 保存先の既定（元ファイルと同じフォルダ。約束 版12）。そのフォルダが無ければ（外付けを外した・フォルダごと消した）書類フォルダに
fn out_dir_for(source: &Path) -> PathBuf {
    let dir = default_out_dir(source);
    if dir.is_dir() {
        return dir;
    }
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join("Documents")
}

/// 履歴から書き終えた録音を開く（処理はしない。書き起こしはそのまま）。元ファイルがあれば、再生のために音声を取り出す
/// （68 分の録音で 1.2 秒）。元ファイルが無くても開ける（書き起こし・名前・サンプルの声は読める。行の再生だけできない）。
/// 途中の録音は開かない（画面は startJob で続きから）
pub fn open_history(engine: &Engine, job_id: &str) -> Result<HistoryOpened, AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    if !finished(&job) {
        return Err(AppError::engine_failed().with_detail(format!("まだ書き終えていない録音: {job_id}")));
    }
    let src = job.source()?;
    engine.set_viewing(job_id);
    // 別の録音を使い終えた（取り出した音声と切り抜きを消す。tidy.rs）。処理中の録音には触らない
    // （処理中にほかの録音を開ける形にしたため。前は処理中の録音の取り出した音声まで消していた）
    let running = engine.running_id();
    let keep: Vec<&str> = [Some(job_id), running.as_deref()].into_iter().flatten().collect();
    let t = tidy::tidy_jobs(&engine.paths, &keep);
    if !t.is_empty() {
        crate::log::write(&engine.paths, &tidy::describe(&t));
    }
    let available = source_state(&job) == SourceState::Ok && ensure_audio(engine, &job);
    let view: serde_json::Value = kikiwake_core::merge::load_json(&job.file("view_transcript.json")).map_err(|e| io_error(&e, "view_transcript.json"))?;
    let unresolved_count = view.get("unresolved").and_then(|u| u.as_array()).map(Vec::len).unwrap_or(0);
    // 版15: 書き起こしの言語（記録の無い前の版の書き起こしは日本語）
    let speech = crate::job::transcript_language(&job);
    Ok(HistoryOpened {
        done: JobDone {
            job_id: job_id.to_string(),
            out_dir: out_dir_for(Path::new(&src.path)).display().to_string(),
            speakers: count_speakers(&job).unwrap_or(0),
            unresolved_count,
            language: speech.map(|s| s.language).unwrap_or_default(),
            language_detected: speech.is_some_and(|s| s.detected),
            names: names_of(&job),
            draft: load_draft(&job),
            screens: crate::screens::info(&job),
        },
        source_available: available,
    })
}

/// 履歴から消す: その録音の作業フォルダを丸ごと消す。元の録音・録画と、保存先に保存した文字起こしのファイルには触らない。
/// 処理中の録音は消さない
pub fn delete_history(engine: &Engine, job_id: &str) -> Result<(), AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    if engine.running_id().as_deref() == Some(job_id) {
        return Err(AppError::engine_failed().with_detail("処理中の録音は履歴から消せない"));
    }
    fs::remove_dir_all(&job.dir).map_err(|e| io_error(&e, "作業フォルダ"))?;
    crate::log::write(&engine.paths, &format!("job {job_id} 履歴から消した"));
    Ok(())
}

/// 元ファイルを選び直す（移動した・名前を変えた・外付けに移した録音を結び直す）。大きさと長さが同じなら同じ録音とみなし、
/// 作業フォルダを新しい場所の ID に付け替えて開く（以後はファイルの画面で選んでも、この履歴に当たる）
pub fn relink_source(engine: &Engine, job_id: &str, path: &Path) -> Result<HistoryOpened, AppError> {
    let job = JobDir::open(&engine.paths, job_id)?;
    // 途中の録音は選び直さない（開けないので。ファイルの画面で選び直すと別の録音として処理する）
    if !finished(&job) {
        return Err(AppError::engine_failed().with_detail(format!("まだ書き終えていない録音: {job_id}")));
    }
    let old = job.source()?;
    let (new_id, fresh) = identify(path)?;
    if new_id != job_id {
        let differs = |what: String| AppError::not_same_recording().with_detail(what);
        if fresh.size_bytes != old.size_bytes {
            return Err(differs(format!("大きさ {}→{}", old.size_bytes, fresh.size_bytes)));
        }
        let info = engines::inspect(&engine.paths, Path::new(&fresh.path))?;
        if (info.duration_sec - old.duration_sec).abs() > 0.5 {
            return Err(differs(format!("長さ {:.2}→{:.2} 秒", old.duration_sec, info.duration_sec)));
        }
        let dst = engine.paths.jobs().join(&new_id);
        if dst.exists() {
            return Err(AppError::engine_failed().with_detail(format!("選んだファイルの作業フォルダがもうある: {new_id}")));
        }
        fs::rename(&job.dir, &dst).map_err(|e| io_error(&e, "作業フォルダ"))?;
    }
    let job = JobDir::open(&engine.paths, &new_id)?;
    let mut src = old;
    src.path = fresh.path;
    src.size_bytes = fresh.size_bytes;
    src.mtime_ns = fresh.mtime_ns;
    let tmp = job.file("source.part");
    fs::write(&tmp, kikiwake_core::pyjson::dumps(&src))
        .and_then(|_| fs::rename(&tmp, job.file("source.json")))
        .map_err(|e| io_error(&e, "source.json"))?;
    crate::log::write(&engine.paths, &format!("job {job_id} 元ファイルを選び直した → {new_id}"));
    open_history(engine, &new_id)
}

// ---- 前の置き場所（Caches）からの引き継ぎ ------------------------------------------------------

/// 引き継ぎの結果（ログ用）
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Migrated {
    /// 移した作業フォルダの数
    pub moved: usize,
    /// 両方にあって、古い方を消した数（新しい方を残す）
    pub replaced: usize,
    /// 移せなかった数（前の置き場所に残してある。次に開いたときにもう一度試す）
    pub failed: usize,
    /// 移した大きさ（バイト）
    pub bytes: u64,
}

impl Migrated {
    pub fn is_empty(&self) -> bool {
        self.moved == 0 && self.replaced == 0 && self.failed == 0
    }

    /// ログの1行（「作業フォルダを Application Support へ移した 2 件（8.4MB）・古い方を消した 0 件・移せなかった 0 件」）
    pub fn describe(&self) -> String {
        format!(
            "作業フォルダを Application Support へ移した {} 件（{:.1}MB）・古い方を消した {} 件・移せなかった {} 件",
            self.moved,
            self.bytes as f64 / 1e6,
            self.replaced,
            self.failed
        )
    }
}

/// フォルダを丸ごと写す（別のボリュームで rename できないとき）
fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_type()?.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// src を dst へ移す。rename できなければ写してから消す（写しきれなければ写しかけを消し、src は残す）
fn move_dir(src: &Path, dst: &Path) -> bool {
    if fs::rename(src, dst).is_ok() {
        return true;
    }
    if copy_dir(src, dst).is_ok() {
        return remove(src);
    }
    let _ = fs::remove_dir_all(dst);
    false
}

/// 前の置き場所（Caches）の作業フォルダを今の置き場所へ移す。同じ ID が両方にあれば、最後に使ったのが新しい方を残す。
/// 16 進の ID でないものには触らない。移し終えて空になった前のフォルダは消す
pub fn migrate_legacy_jobs(paths: &Paths) -> Migrated {
    let mut m = Migrated::default();
    let Some(legacy) = &paths.legacy_work else {
        return m;
    };
    let from = legacy.join("jobs");
    let Ok(rd) = fs::read_dir(&from) else {
        return m;
    };
    let to = paths.jobs();
    if fs::create_dir_all(&to).is_err() {
        return m;
    }
    for e in rd.flatten() {
        let src = e.path();
        let id = e.file_name().to_string_lossy().into_owned();
        if !src.is_dir() || !is_job_id(&id) {
            continue;
        }
        let dst = to.join(&id);
        let size = size_of(&src);
        if dst.exists() {
            // 両方にある: 最後に使ったのが新しい方を残す
            let newer = matches!((last_used(&src), last_used(&dst)), (Some(a), Some(b)) if a > b);
            if !newer {
                if remove(&src) {
                    m.replaced += 1;
                }
                continue;
            }
            // 前の置き場所の方が新しい。今の方を脇へよけてから移し、移せたら消す（移せなければ元に戻す）
            let aside = to.join(format!(".{id}.old"));
            let _ = fs::remove_dir_all(&aside);
            if fs::rename(&dst, &aside).is_err() {
                m.failed += 1;
                continue;
            }
            if move_dir(&src, &dst) {
                let _ = fs::remove_dir_all(&aside);
                m.replaced += 1;
                m.bytes += size;
            } else {
                let _ = fs::rename(&aside, &dst);
                m.failed += 1;
            }
            continue;
        }
        if move_dir(&src, &dst) {
            m.moved += 1;
            m.bytes += size;
        } else {
            m.failed += 1;
        }
    }
    // 空になった前の置き場所は消す（ほかの物が残っていれば残す）
    if fs::remove_dir(&from).is_ok() {
        let _ = fs::remove_dir(legacy);
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kikiwake-history-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    fn paths_in(root: &Path) -> Paths {
        Paths {
            models: root.join("models"),
            app_data: root.join("app"),
            work: root.join("app"),
            legacy_work: Some(root.join("caches")),
            logs: root.join("logs"),
            engines: root.join("engines"),
        }
    }

    /// 作業フォルダを作る（中身の目印 mark・最後に使った日時 age_min 分前）
    fn job(dir: &Path, mark: &str, age_min: u64) {
        fs::create_dir_all(dir.join("samples")).unwrap();
        fs::write(dir.join("words.json"), mark).unwrap();
        fs::write(dir.join("samples/話者A_1.wav"), vec![0u8; 10]).unwrap();
        let src = fs::File::create(dir.join("source.json")).unwrap();
        src.set_modified(SystemTime::now() - Duration::from_secs(age_min * 60)).unwrap();
    }

    #[test]
    fn moves_legacy_jobs_once_and_keeps_the_newer() {
        let root = tmp("migrate");
        let paths = paths_in(&root);
        let old = root.join("caches/jobs");
        job(&old.join("aaaa"), "前の置き場所だけ", 10);
        job(&old.join("bbbb"), "前の置き場所の方が新しい", 1);
        job(&paths.jobs().join("bbbb"), "今の置き場所の方が古い", 60);
        job(&old.join("cccc"), "前の置き場所の方が古い", 60);
        job(&paths.jobs().join("cccc"), "今の置き場所の方が新しい", 1);
        let m = migrate_legacy_jobs(&paths);
        assert_eq!((m.moved, m.replaced, m.failed), (1, 2, 0));
        let words = |id: &str| fs::read_to_string(paths.jobs().join(id).join("words.json")).unwrap();
        assert_eq!(words("aaaa"), "前の置き場所だけ");
        assert_eq!(words("bbbb"), "前の置き場所の方が新しい");
        assert_eq!(words("cccc"), "今の置き場所の方が新しい");
        assert!(paths.jobs().join("aaaa/samples/話者A_1.wav").is_file());
        // 移し終えたら前の置き場所は消える。2回目は何もしない
        assert!(!root.join("caches").exists());
        assert!(migrate_legacy_jobs(&paths).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn leaves_non_job_things_in_the_legacy_folder() {
        let root = tmp("migrate-other");
        let paths = paths_in(&root);
        let old = root.join("caches/jobs");
        job(&old.join("dddd"), "移す", 5);
        fs::create_dir_all(old.join("not-a-job")).unwrap();
        fs::write(old.join("memo.txt"), b"x").unwrap();
        let m = migrate_legacy_jobs(&paths);
        assert_eq!(m.moved, 1);
        // 16進の ID でないものには触らない（前の置き場所も、それが残るので消さない）
        assert!(old.join("not-a-job").is_dir() && old.join("memo.txt").is_file());
        assert!(!paths.jobs().join("not-a-job").exists());
        let _ = fs::remove_dir_all(&root);
    }

    struct NoEvents;
    impl crate::types::Events for NoEvents {
        fn job_progress(&self, _: &crate::types::JobProgress) {}
        fn job_done(&self, _: &JobDone) {}
        fn job_failed(&self, _: &crate::types::JobFailed) {}
        fn model_progress(&self, _: &crate::types::ModelInfo) {}
    }

    fn write_source(dir: &Path, path: &str, size: u64, status: &str, age_min: u64) {
        let src = serde_json::json!({"path": path, "sizeBytes": size, "mtimeNs": 1, "durationSec": 120.0, "processedAt": "2026-09-27", "status": status});
        fs::write(dir.join("source.json"), src.to_string()).unwrap();
        let f = fs::File::options().write(true).open(dir.join("source.json")).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(age_min * 60)).unwrap();
    }

    /// 書き終えた録音の作業フォルダ（結果の一式）
    fn finished_job(dir: &Path, path: &str, age_min: u64) {
        fs::create_dir_all(dir.join("samples")).unwrap();
        for f in ["words.json", "diarization.json", "meta.json"] {
            fs::write(dir.join(f), "[]").unwrap();
        }
        fs::write(dir.join("view_transcript.json"), r#"{"utterances":[],"unresolved":[{"id":"u3"}]}"#).unwrap();
        fs::write(dir.join("speakers.json"), r#"[{"label":"話者A"},{"label":"話者B"}]"#).unwrap();
        write_source(dir, path, 10, "done", age_min);
    }

    #[test]
    fn lists_done_and_unfinished_recordings_newest_first() {
        let root = tmp("list");
        let mut paths = paths_in(&root);
        paths.legacy_work = None;
        let engine = Engine::new(paths.clone(), std::sync::Arc::new(NoEvents));
        let jobs = paths.jobs();
        finished_job(&jobs.join("aaaa"), "/nowhere/定例.m4a", 30);
        // 処理の途中で閉じた（話者の判定まで済んだ）録音も出す（2026-09-27 決定）
        fs::create_dir_all(jobs.join("bbbb")).unwrap();
        fs::write(jobs.join("bbbb/diarization.json"), r#"[{"start":0.0,"end":1.0,"speaker":"speaker_0"}]"#).unwrap();
        write_source(&jobs.join("bbbb"), "/nowhere/面談.mp4", 10, "cancelled", 5);
        // 16 進の ID でないもの・source.json の無いものは出さない
        fs::create_dir_all(jobs.join("not-a-job")).unwrap();
        fs::create_dir_all(jobs.join("cccc")).unwrap();
        let list = list_history(&engine);
        let ids: Vec<&str> = list.iter().map(|i| i.job_id.as_str()).collect();
        assert_eq!(ids, ["bbbb", "aaaa"]); // 最後に使った順
        assert_eq!((list[0].status, list[0].speakers, list[0].diarization_kept), (HistoryStatus::Unfinished, Some(1), true));
        assert_eq!((list[1].status, list[1].speakers, list[1].name.as_str()), (HistoryStatus::Done, Some(2), "定例.m4a"));
        assert!(!list[1].source_available && !list[1].named && !list[1].unsaved_edits);
        // 名前を確定し、手直しを残すと、一番上に来る
        fs::write(jobs.join("aaaa/names.json"), r#"{"話者A":"佐藤"}"#).unwrap();
        save_draft(&engine, "aaaa", &serde_json::json!({"screen": "result", "unsaved": true})).unwrap();
        let list = list_history(&engine);
        assert_eq!(list[0].job_id, "aaaa");
        assert!(list[0].named && list[0].unsaved_edits);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn opens_without_the_source_and_keeps_the_draft_only_for_the_same_transcript() {
        let root = tmp("open");
        let mut paths = paths_in(&root);
        paths.legacy_work = None;
        let engine = Engine::new(paths.clone(), std::sync::Arc::new(NoEvents));
        let jobs = paths.jobs();
        finished_job(&jobs.join("aaaa"), "/nowhere/定例.m4a", 1);
        let draft = serde_json::json!({"screen": "result", "lineNames": {"u3": "田中"}, "unsaved": true});
        save_draft(&engine, "aaaa", &draft).unwrap();
        // 元ファイルが無くても開ける（再生だけできない）。保存先の既定は、元のフォルダが無いので書類フォルダ
        let o = open_history(&engine, "aaaa").unwrap();
        assert!(!o.source_available);
        assert_eq!((o.done.speakers, o.done.unresolved_count), (2, 1));
        assert_eq!(o.done.draft.as_ref(), Some(&draft));
        assert!(o.done.out_dir.ends_with("/Documents"), "{}", o.done.out_dir);
        // 書き起こしが変わったら（行の id が合わないので）閉じたときの状態は使わない
        fs::write(jobs.join("aaaa/view_transcript.json"), r#"{"utterances":[{"id":"u0"}],"unresolved":[]}"#).unwrap();
        assert_eq!(open_history(&engine, "aaaa").unwrap().done.draft, None);
        // 途中の録音は開かない（画面は startJob で続きから）
        fs::create_dir_all(jobs.join("bbbb")).unwrap();
        write_source(&jobs.join("bbbb"), "/nowhere/面談.mp4", 10, "failed", 1);
        assert!(open_history(&engine, "bbbb").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_removes_only_the_work_folder_and_relink_checks_the_size() {
        let root = tmp("delete");
        let mut paths = paths_in(&root);
        paths.legacy_work = None;
        let engine = Engine::new(paths.clone(), std::sync::Arc::new(NoEvents));
        // 元の録音と保存したファイル（作業フォルダの外）は消えない
        let rec = root.join("録音/定例.m4a");
        let saved = root.join("録音/定例_文字起こし.md");
        fs::create_dir_all(saved.parent().unwrap()).unwrap();
        fs::write(&rec, b"0123456789").unwrap();
        fs::write(&saved, b"# x").unwrap();
        let (id, _) = identify(&rec).unwrap();
        finished_job(&paths.jobs().join(&id), &rec.display().to_string(), 1);
        // 大きさが違うファイルを選び直すと、別の録音として断る
        let other = root.join("録音/別.m4a");
        fs::write(&other, b"01234").unwrap();
        let e = relink_source(&engine, &id, &other).unwrap_err();
        assert_eq!(e.code, "not_same_recording");
        delete_history(&engine, &id).unwrap();
        assert!(!paths.jobs().join(&id).exists());
        assert!(rec.is_file() && saved.is_file() && other.is_file());
        assert!(list_history(&engine).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn opening_another_recording_keeps_the_running_one_intact() {
        // 処理中にほかの録音を開いても、処理中の録音の取り出した音声（取り出し途中を含む）と切り抜きは消さない
        // （2026-09-27。案A で処理中にほかの録音を開けるようにした。前は消していて、処理が最後まで進まなかった）
        let root = tmp("open-running");
        let mut paths = paths_in(&root);
        paths.legacy_work = None;
        let engine = Engine::new(paths.clone(), std::sync::Arc::new(NoEvents));
        let jobs = paths.jobs();
        finished_job(&jobs.join("aaaa"), "/nowhere/定例.m4a", 5);
        let run = jobs.join("bbbb");
        fs::create_dir_all(run.join("clips")).unwrap();
        for f in ["audio.wav", "audio.part.wav", "clips/1_2.wav"] {
            fs::write(run.join(f), b"x").unwrap();
        }
        write_source(&run, "/nowhere/面談.mp4", 10, "running", 1);
        // 使い終えた録音（処理中でも、開いてもいない）の音声は消す
        let old = jobs.join("cccc");
        finished_job(&old, "/nowhere/古い.m4a", 60);
        fs::write(old.join("audio.wav"), b"x").unwrap();
        let running = engine.fake_running("bbbb", false);
        open_history(&engine, "aaaa").unwrap();
        assert!(run.join("audio.wav").is_file() && run.join("audio.part.wav").is_file() && run.join("clips/1_2.wav").is_file());
        assert!(!old.join("audio.wav").exists());
        assert_eq!(engine.viewing_id().as_deref(), Some("aaaa"));
        // 処理中の録音は一覧に出さない・消させない
        assert!(list_history(&engine).iter().all(|i| i.job_id != "bbbb"));
        assert!(delete_history(&engine, "bbbb").is_err());
        drop(running);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn tells_missing_from_changed_and_lists_names_by_talk_time() {
        // 版9: 元ファイルの状態（ある・見つからない・変わった）・保存したことがあるか・付けた名前（発言の多い順）
        let root = tmp("state");
        let mut paths = paths_in(&root);
        paths.legacy_work = None;
        let engine = Engine::new(paths.clone(), std::sync::Arc::new(NoEvents));
        let rec = root.join("録音/定例.m4a");
        fs::create_dir_all(rec.parent().unwrap()).unwrap();
        fs::write(&rec, b"0123456789").unwrap();
        let (id, _) = identify(&rec).unwrap();
        let dir = paths.jobs().join(&id);
        finished_job(&dir, &rec.display().to_string(), 1);
        // 話者A 10 秒・話者B 30 秒・話者C 5 秒・話者D 25 秒。A と D に同じ名前 → 松本 35 秒・田中 30 秒・名前なし 1 人
        let turns = r#"[{"start":0.0,"end":10.0,"speaker":"s0"},{"start":10.0,"end":40.0,"speaker":"s1"},{"start":40.0,"end":45.0,"speaker":"s2"},{"start":45.0,"end":70.0,"speaker":"s3"}]"#;
        fs::write(dir.join("diarization.json"), turns).unwrap();
        let item = |engine: &Engine| list_history(engine).into_iter().find(|i| i.job_id == id).unwrap();
        let first = item(&engine);
        assert_eq!((first.source_state, first.source_available, first.saved), (SourceState::Ok, true, false));
        assert_eq!((first.named_speakers, first.saved_files), (None, None));
        fs::write(dir.join("names.json"), r#"{"話者A":"松本","話者B":"田中","話者D":"松本"}"#).unwrap();
        assert_eq!(item(&engine).named_speakers, Some(NamedSpeakers { names: vec!["松本".into(), "田中".into()], unnamed: 1 }));
        // 保存したことがある（閉じたときの状態の savedOnce。前の版の状態は savedFiles で）
        save_draft(&engine, &id, &serde_json::json!({"screen": "result", "unsaved": true, "savedOnce": true})).unwrap();
        assert!(item(&engine).saved);
        assert_eq!(item(&engine).saved_files, None);
        save_draft(&engine, &id, &serde_json::json!({"screen": "result", "unsaved": false, "savedFiles": ["/x/transcript_named.md"]})).unwrap();
        assert!(item(&engine).saved);
        // 版12: 最後に保存したファイルは lastSavedFiles（保存したあとで名前を変えて savedFiles が空に戻っても残る）。前の版の状態は savedFiles
        assert_eq!(item(&engine).saved_files, Some(vec!["/x/transcript_named.md".to_string()]));
        let last = serde_json::json!({"screen": "result", "unsaved": true, "savedOnce": true, "savedFiles": [], "lastSavedFiles": ["/x/定例_文字起こし.md"]});
        save_draft(&engine, &id, &last).unwrap();
        assert_eq!(item(&engine).saved_files, Some(vec!["/x/定例_文字起こし.md".to_string()]));
        // 同じ場所にあるが中身（大きさか更新日時）が変わった → changed。無くなった → missing
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&rec, b"9876543210").unwrap();
        assert_eq!(item(&engine).source_state, SourceState::Changed);
        assert!(!item(&engine).source_available);
        fs::remove_file(&rec).unwrap();
        assert_eq!(item(&engine).source_state, SourceState::Missing);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_to_move_is_fine() {
        let root = tmp("migrate-none");
        assert!(migrate_legacy_jobs(&paths_in(&root)).is_empty());
        let mut p = paths_in(&root);
        p.legacy_work = None;
        assert!(migrate_legacy_jobs(&p).is_empty());
    }
}
