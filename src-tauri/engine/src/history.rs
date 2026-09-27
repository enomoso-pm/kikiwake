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
use crate::types::{HistoryItem, HistoryOpened, HistoryStatus, JobDone};

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

/// 元ファイルが今もあるか（同じ場所・大きさ・更新日時。つまり同じ ID になるか）
fn source_available(job: &JobDir) -> bool {
    job.source().ok().and_then(|s| identify(Path::new(&s.path)).ok()).is_some_and(|(id, _)| id == job.id)
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
            source_available: source_available(&job),
            diarization_kept: job.diarization().is_file(),
        };
        items.push((last_touched(&job), item));
    }
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.job_id.cmp(&b.1.job_id)));
    items.into_iter().map(|(_, i)| i).collect()
}

/// 保存先の既定。元ファイルのあったフォルダが無ければ（外付けを外した・フォルダごと消した）書類フォルダに
fn out_dir_for(engine: &Engine, source: &Path) -> PathBuf {
    let dir = default_out_dir(source, engine.locale());
    if dir.parent().is_some_and(Path::is_dir) {
        return dir;
    }
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    home.join("Documents").join(dir.file_name().unwrap_or_default())
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
    // 別の録音を使い終えた（取り出した音声と切り抜きを消す。tidy.rs）
    let t = tidy::tidy_jobs(&engine.paths, Some(job_id));
    if !t.is_empty() {
        crate::log::write(&engine.paths, &tidy::describe(&t));
    }
    let mut available = source_available(&job);
    if available && !job.audio().is_file() {
        let tmp = job.file("audio.part.wav");
        let cancel = crate::proc::Cancel::new();
        match engines::decode(&engine.paths, Path::new(&src.path), &tmp, &cancel).and_then(|_| {
            fs::rename(&tmp, job.audio()).map_err(|e| io_error(&e, "audio.wav"))
        }) {
            Ok(()) => crate::log::write(&engine.paths, &format!("job {job_id} 履歴から開いた（音声を取り出した）")),
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                crate::log::write(&engine.paths, &format!("job {job_id} 履歴から開いた・音声を取り出せない {e}"));
                available = false;
            }
        }
    }
    let view: serde_json::Value = kikiwake_core::merge::load_json(&job.file("view_transcript.json")).map_err(|e| io_error(&e, "view_transcript.json"))?;
    let unresolved_count = view.get("unresolved").and_then(|u| u.as_array()).map(Vec::len).unwrap_or(0);
    Ok(HistoryOpened {
        done: JobDone {
            job_id: job_id.to_string(),
            out_dir: out_dir_for(engine, Path::new(&src.path)).display().to_string(),
            speakers: count_speakers(&job).unwrap_or(0),
            unresolved_count,
            names: names_of(&job),
            draft: load_draft(&job),
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
        assert!(o.done.out_dir.ends_with("Documents/定例_文字起こし"), "{}", o.done.out_dir);
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
        let saved = root.join("録音/定例_文字起こし/transcript.md");
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
    fn nothing_to_move_is_fine() {
        let root = tmp("migrate-none");
        assert!(migrate_legacy_jobs(&paths_in(&root)).is_empty());
        let mut p = paths_in(&root);
        p.legacy_work = None;
        assert!(migrate_legacy_jobs(&p).is_empty());
    }
}
