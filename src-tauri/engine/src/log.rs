//! ログ（~/Library/Logs/Kikiwake/kikiwake.log）。段階・時刻・所要時間・エラーだけを書き、文字起こしの中身は書かない。
//! 録音の名前と場所も書かない（形式と大きさだけ）。エラーの詳細に場所が入るときは、ホームフォルダを「~」にする
use std::fs::{self, OpenOptions};
use std::io::Write;

use crate::paths::Paths;

const MAX_BYTES: u64 = 5_000_000;

/// ホームフォルダ（/Users/<名前>）を「~」にする。ログや「詳細をコピー」を Issue に貼っても、Mac のユーザー名が出ないように
pub fn redact_home(s: &str) -> String {
    match std::env::var("HOME") {
        Ok(h) if h.len() > 1 && s.contains(&format!("{h}/")) => s.replace(&format!("{h}/"), "~/"),
        _ => s.to_string(),
    }
}

pub fn write(paths: &Paths, msg: &str) {
    let msg = redact_home(msg);
    let _ = fs::create_dir_all(&paths.logs);
    let file = paths.logs.join("kikiwake.log");
    if fs::metadata(&file).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = fs::rename(&file, paths.logs.join("kikiwake.1.log"));
    }
    let line = format!("{} {msg}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = f.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn home_folder_becomes_tilde() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(super::redact_home(&format!("開けない: {home}/Downloads/a.m4a")), "開けない: ~/Downloads/a.m4a");
        assert_eq!(super::redact_home("/Users/Shared/a.m4a"), "/Users/Shared/a.m4a");
    }
}
