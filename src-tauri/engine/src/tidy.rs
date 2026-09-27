//! 作業フォルダの掃除（2026-09-26 決定。2026-09-27 に履歴のため丸ごと消すのをやめた）。
//!
//! 作業フォルダ（~/Library/Application Support/Kikiwake/jobs/<録音ごとの ID>/）がそのまま履歴になる。
//! その 9 割は取り出した音声で（68 分の録音で 144MB のうち 130MB）、消さないと 1 時間の会議を週 5 本で 1 年に約 30GB たまる。
//! - 取り出した音声（audio.wav・取り出し途中の audio.part.wav）と行の再生の切り抜き（clips/）は、その録音を使い終えたら消す。
//!   使い終えた＝別の録音を始めたとき・別の録音を開いたとき・アプリを終えるとき（落ちて消せなかったぶんは次に開いたとき）。
//!   処理中の録音と、画面で見ている録音には触らない（2026-09-27。処理中にほかの録音を開ける形にしたため。keep で渡す）
//!   書き起こし・話者の判定・サンプルの声・付けた名前・手直しは残す（68 分の録音で約 9MB）。同じ録音を開き直すと、
//!   元の録音から音声を取り出し直すだけで戻る（68 分の録音で 1.2 秒）
//! - 作業フォルダを丸ごと消すのは、利用者が履歴から消したときだけ（history.rs）。前は 30 日選び直していない録音を丸ごと消していた
//!
//! 元の録音・録画（利用者のファイル）と、保存先に保存したファイルには触らない。動画を渡されても、作業フォルダに入るのは取り出した音声だけ。
use std::fs;
use std::path::Path;
use std::time::SystemTime;

use crate::paths::Paths;

/// 使い終えた録音から消すもの（作業フォルダの中の名前）
const HEAVY: [&str; 3] = ["audio.wav", "audio.part.wav", "clips"];

/// 掃除の結果（ログ用）
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Tidied {
    /// 音声などを消した録音の数
    pub audio: usize,
    /// 消した大きさ（バイト）
    pub bytes: u64,
}

impl Tidied {
    pub fn is_empty(&self) -> bool {
        self.audio == 0
    }
}

/// 録音を最後に使った日時: source.json（処理を始めるたび・終わるたびに書く）の更新日時。無ければフォルダの更新日時
pub(crate) fn last_used(dir: &Path) -> Option<SystemTime> {
    fs::metadata(dir.join("source.json")).or_else(|_| fs::metadata(dir)).and_then(|m| m.modified()).ok()
}

pub(crate) fn size_of(p: &Path) -> u64 {
    match fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => fs::read_dir(p).map(|rd| rd.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

pub(crate) fn remove(p: &Path) -> bool {
    match fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(p).is_ok(),
        Ok(_) => fs::remove_file(p).is_ok(),
        Err(_) => false,
    }
}

/// 作業フォルダの名前か（16 進の ID だけ。ほかの物が置かれていても触らない）
pub(crate) fn is_job_id(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_hexdigit())
}

/// 作業フォルダの、取り出した音声と行の再生の切り抜きを消す。keep の録音（処理中の録音・画面で見ている録音）には触らない。
/// 書き起こしなどは残す（作業フォルダを丸ごと消すのは、利用者が履歴から消したときだけ）
pub fn tidy_jobs(paths: &Paths, keep: &[&str]) -> Tidied {
    let mut t = Tidied::default();
    let Ok(rd) = fs::read_dir(paths.jobs()) else {
        return t;
    };
    for e in rd.flatten() {
        let dir = e.path();
        let id = e.file_name().to_string_lossy().into_owned();
        if !dir.is_dir() || !is_job_id(&id) || keep.contains(&id.as_str()) {
            continue;
        }
        let mut removed = false;
        for name in HEAVY {
            let p = dir.join(name);
            let size = size_of(&p);
            if remove(&p) {
                removed = true;
                t.bytes += size;
            }
        }
        if removed {
            t.audio += 1;
        }
    }
    t
}

/// ログの1行（「作業ファイルの掃除 音声 2 件（260.4MB）」）
pub fn describe(t: &Tidied) -> String {
    format!("作業ファイルの掃除 音声 {} 件（{:.1}MB）", t.audio, t.bytes as f64 / 1e6)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    fn paths_in(root: &Path) -> Paths {
        Paths {
            models: root.join("models"),
            app_data: root.join("app"),
            work: root.join("work"),
            legacy_work: None,
            logs: root.join("logs"),
            engines: root.join("engines"),
        }
    }

    fn job(paths: &Paths, id: &str, age_days: u64, now: SystemTime) -> PathBuf {
        let dir = paths.jobs().join(id);
        fs::create_dir_all(dir.join("clips")).unwrap();
        fs::create_dir_all(dir.join("samples")).unwrap();
        fs::write(dir.join("audio.wav"), vec![0u8; 1000]).unwrap();
        fs::write(dir.join("clips/10_20.wav"), vec![0u8; 100]).unwrap();
        fs::write(dir.join("samples/話者A_1.wav"), vec![0u8; 10]).unwrap();
        fs::write(dir.join("asr.json"), b"[]").unwrap();
        let src = fs::File::create(dir.join("source.json")).unwrap();
        src.set_modified(now - Duration::from_secs(age_days * 24 * 60 * 60)).unwrap();
        dir
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kikiwake-tidy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn removes_audio_and_clips_but_keeps_results() {
        let root = tmp("audio");
        let paths = paths_in(&root);
        let now = SystemTime::now();
        let a = job(&paths, "aaaa", 1, now);
        let b = job(&paths, "bbbb", 1, now);
        let c = job(&paths, "cccc", 1, now);
        let t = tidy_jobs(&paths, &["bbbb", "cccc"]);
        assert_eq!(t, Tidied { audio: 1, bytes: 1100 });
        assert!(!a.join("audio.wav").exists() && !a.join("clips").exists());
        assert!(a.join("asr.json").exists() && a.join("samples/話者A_1.wav").exists() && a.join("source.json").exists());
        // いま使っている録音（処理中の録音と、画面で見ている録音）には触らない
        for d in [&b, &c] {
            assert!(d.join("audio.wav").exists() && d.join("clips/10_20.wav").exists());
        }
        // もう一度掃除しても何も消さない
        assert!(tidy_jobs(&paths, &["bbbb", "cccc"]).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_old_jobs_as_history() {
        // 2026-09-27: 作業フォルダは履歴なので、長く使っていない録音も丸ごとは消さない（音声と切り抜きだけ消す）
        let root = tmp("old");
        let paths = paths_in(&root);
        let now = SystemTime::now();
        let old = job(&paths, "0001", 400, now);
        // 16進の ID でないフォルダ・ファイルには触らない
        fs::create_dir_all(paths.jobs().join("not-a-job/clips")).unwrap();
        fs::write(paths.jobs().join("not-a-job/audio.wav"), b"x").unwrap();
        fs::write(paths.jobs().join("memo.txt"), b"x").unwrap();
        let t = tidy_jobs(&paths, &[]);
        assert_eq!(t.audio, 1);
        assert!(old.join("asr.json").exists() && old.join("source.json").exists() && old.join("samples/話者A_1.wav").exists());
        assert!(!old.join("audio.wav").exists());
        assert!(paths.jobs().join("not-a-job/audio.wav").exists() && paths.jobs().join("memo.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_jobs_folder_is_fine() {
        let root = tmp("none");
        assert!(tidy_jobs(&paths_in(&root), &[]).is_empty());
    }
}
