//! エンジンを別のプロセスで動かす（中止・進み具合の取得・障害の切り分けが簡単）。
//! 標準出力と標準エラーを1行ずつ受け取り、中止ならプロセスを止める。
use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// 中止の合図。動いているエンジンがあれば止める
#[derive(Debug, Default)]
pub struct Cancel {
    flag: AtomicBool,
    pid: Mutex<Option<u32>>,
}

impl Cancel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        if let Some(pid) = *self.pid.lock().unwrap() {
            // SAFETY: 自分が起動した子プロセスに合図を送るだけ
            unsafe {
                libc::kill(pid as libc::pid_t, libc::SIGKILL);
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

pub struct Finished {
    pub status: ExitStatus,
    /// 標準エラーの最後の数十行（失敗したときの詳細・ログ用。文字起こしの中身は含まない）
    pub stderr_tail: Vec<String>,
    /// 止めたのが中止の合図か
    pub cancelled: bool,
}

impl Finished {
    /// 中止していないのに SIGKILL で止まった（macOS がメモリ不足で止めたとき）
    pub fn killed_by_system(&self) -> bool {
        use std::os::unix::process::ExitStatusExt;
        !self.cancelled && self.status.signal() == Some(libc::SIGKILL)
    }

    pub fn detail(&self, name: &str) -> String {
        let code = match self.status.code() {
            Some(c) => format!("終了コード {c}"),
            None => {
                use std::os::unix::process::ExitStatusExt;
                format!("シグナル {}", self.status.signal().unwrap_or(0))
            }
        };
        format!("{name}: {code}\n{}", self.stderr_tail.join("\n"))
    }
}

const TAIL: usize = 40;

/// 改行（\n）と行頭復帰（\r）の両方で区切って1行ずつ渡す
fn each_line(r: impl Read, mut f: impl FnMut(&str)) {
    let mut reader = BufReader::new(r);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                for part in buf.split(|&b| b == b'\n' || b == b'\r') {
                    if !part.is_empty() {
                        f(&String::from_utf8_lossy(part));
                    }
                }
            }
        }
    }
}

/// 動かして終わるまで待つ。中止の合図が来たら止める
pub fn run<S: AsRef<OsStr>>(
    exe: &Path,
    args: &[S],
    cancel: &Cancel,
    mut on_stdout: impl FnMut(&str) + Send,
    mut on_stderr: impl FnMut(&str) + Send,
) -> std::io::Result<Finished> {
    if cancel.is_cancelled() {
        return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "中止"));
    }
    let mut child = Command::new(exe).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    *cancel.pid.lock().unwrap() = Some(child.id());
    // 起動と同時に中止されたとき（pid を書く前に合図が来た）
    if cancel.is_cancelled() {
        let _ = child.kill();
    }
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");
    let mut tail: Vec<String> = Vec::new();
    std::thread::scope(|s| {
        s.spawn(move || each_line(stdout, &mut on_stdout));
        each_line(stderr, |line| {
            on_stderr(line);
            tail.push(line.to_string());
            if tail.len() > TAIL {
                tail.remove(0);
            }
        });
    });
    let status = child.wait()?;
    *cancel.pid.lock().unwrap() = None;
    Ok(Finished { status, stderr_tail: tail, cancelled: cancel.is_cancelled() })
}
