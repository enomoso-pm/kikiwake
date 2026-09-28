//! 処理の流れ: 音声の取り出し → 話者判定 → 書き起こし → 突き合わせ。
//! 作業用のファイルは作業フォルダ（~/Library/Application Support/Kikiwake/jobs/<録音ごとの ID>/。そのまま履歴になる）に置く。保存先には利用者が保存したファイルだけを書く。
//! 中止したら動いているエンジンを止める。話者判定まで済んでいれば残し、やり直すと使い回す。
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use kikiwake_core::lang::Lang;
use kikiwake_core::merge::{self, Meta, Turn, Word};
use kikiwake_core::repeat::{self, Repeat};
use kikiwake_core::{diar, lines, pycompat, pyjson, unresolved, view, wav, whisper};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::engines;
use crate::error::{io_error, AppError};
use crate::log;
use crate::paths::Paths;
use crate::proc::Cancel;
use crate::tidy;
use crate::types::{Events, JobDone, JobFailed, JobProgress, JobStarted, RepeatNotice, Stage};

pub const DIARIZER_NAME: &str = "Nemotron 3 Diarization";
pub const ASR_NAME: &str = "Whisper large-v3（whisper.cpp）";

/// 録音ごとの作業フォルダ
#[derive(Clone, Debug)]
pub struct JobDir {
    pub id: String,
    pub dir: PathBuf,
}

impl JobDir {
    pub fn open(paths: &Paths, id: &str) -> Result<Self, AppError> {
        // ID は16進の文字だけ（画面から来た値でフォルダの外を指させない）
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(AppError::file_not_found().with_detail(format!("作業の ID が正しくない: {id}")));
        }
        let dir = paths.jobs().join(id);
        if !dir.is_dir() {
            return Err(AppError::file_not_found().with_detail(format!("作業フォルダが無い: {}", dir.display())));
        }
        Ok(Self { id: id.to_string(), dir })
    }
    pub fn file(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }
    pub fn audio(&self) -> PathBuf {
        self.file("audio.wav")
    }
    pub fn samples(&self) -> PathBuf {
        self.file("samples")
    }
    pub fn diarization(&self) -> PathBuf {
        self.file("diarization.json")
    }
    pub fn source(&self) -> Result<Source, AppError> {
        merge::load_json(&self.file("source.json")).map_err(|e| io_error(&e, "source.json"))
    }
}

/// 元ファイルの記録（source.json）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub path: String,
    pub size_bytes: u64,
    pub mtime_ns: u128,
    #[serde(default)]
    pub duration_sec: f64,
    /// 前回の処理日 YYYY-MM-DD
    pub processed_at: String,
    /// running・done・cancelled・failed
    pub status: String,
}

/// 同じ録音か: 元ファイルの場所・大きさ・更新日時が同じなら同じ ID（中身を読まずに決められる）
pub fn identify(path: &Path) -> Result<(String, Source), AppError> {
    let md = fs::metadata(path).map_err(|_| AppError::file_not_found().with_detail(path.display().to_string()))?;
    if !md.is_file() {
        return Err(AppError::file_not_found().with_detail(path.display().to_string()));
    }
    let abs = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mtime = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    let mut h = Sha256::new();
    h.update(abs.to_string_lossy().as_bytes());
    h.update(md.len().to_le_bytes());
    h.update(mtime.to_le_bytes());
    let id: String = h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect();
    let src = Source {
        path: abs.to_string_lossy().into_owned(),
        size_bytes: md.len(),
        mtime_ns: mtime,
        duration_sec: 0.0,
        processed_at: today(),
        status: "running".into(),
    };
    Ok((id, src))
}

pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// 保存先の既定: 元ファイルと同じフォルダ（約束 版12。版11までは隣の「<名前>_文字起こし/」）。
/// 画面は利用者が一度選んだ保存先を覚えていて、選んでいなければここに保存する（2026-09-29 決定）
pub fn default_out_dir(source: &Path) -> PathBuf {
    source.parent().unwrap_or(Path::new("/")).to_path_buf()
}

/// 保存するファイルの名前（拡張子なし）: 「<元ファイルの名前>_文字起こし」。英語の画面では「<名前>_transcript」（約束 版12。
/// 名前を付けたかどうかでは変えない。版11までは Python 版と同じ transcript_named／transcript だった）
pub fn saved_stem(source: &Path, lang: Lang) -> String {
    let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let suffix = match lang {
        Lang::Ja => "文字起こし",
        Lang::En => "transcript",
    };
    format!("{stem}_{suffix}")
}

/// ファイルシステムの空き（バイト）
pub fn free_bytes(dir: &Path) -> Option<u64> {
    let mut p = dir.to_path_buf();
    while !p.exists() {
        p = p.parent()?.to_path_buf();
    }
    let c = std::ffi::CString::new(p.as_os_str().as_encoded_bytes()).ok()?;
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: 存在するパスと、書き込み先の構造体を渡すだけ
    if unsafe { libc::statfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    Some(st.f_bavail as u64 * st.f_bsize as u64)
}

fn write_json<T: Serialize + ?Sized>(path: &Path, v: &T) -> Result<(), AppError> {
    let tmp = path.with_extension("part");
    fs::write(&tmp, pyjson::dumps(v)).and_then(|_| fs::rename(&tmp, path)).map_err(|e| io_error(&e, &path.display().to_string()))
}

// ---- この Mac での書き起こしの速さ（所要時間の目安の補正） ------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Speed {
    /// 書き起こしにかかった時間 ÷ 録音の長さ
    pub transcribe_ratio: f64,
    pub measured_at: String,
}

/// 画面の言語を覚えておくファイル（アプリのデータの中。中身は「ja」か「en」）
const LOCALE_FILE: &str = "locale.txt";

/// 前に画面が知らせた言語（約束 版7）。無い・読めないときは None
pub fn remembered_locale(paths: &Paths) -> Option<Lang> {
    fs::read_to_string(paths.app_data.join(LOCALE_FILE)).ok().and_then(|s| Lang::parse(&s))
}

pub fn load_speed(paths: &Paths) -> Option<Speed> {
    merge::load_json(&paths.app_data.join("speed.json")).ok()
}

fn save_speed(paths: &Paths, ratio: f64) {
    let _ = fs::create_dir_all(&paths.app_data);
    let _ = fs::write(
        paths.app_data.join("speed.json"),
        pyjson::dumps(&Speed { transcribe_ratio: pycompat::round(ratio, 4), measured_at: today() }),
    );
}

// ---- 処理の流れ ------------------------------------------------------------------------------

/// 処理の間だけ Mac を起こしたままにする（しばらく操作が無くてもスリープしない。ふたを閉じたときは止められない）。
/// macOS の caffeinate を使う。アプリが落ちても残らないよう、-w で本体の終わりも待たせる。
/// Phase 2 の 4.5 時間の計測中に Mac がスリープし（しばらく操作が無かったため）、処理が 2 時間止まったので足した
struct KeepAwake(Option<std::process::Child>);

impl KeepAwake {
    fn start() -> Self {
        let pid = std::process::id().to_string();
        let child = std::process::Command::new("/usr/bin/caffeinate")
            .args(["-i", "-w", &pid])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok();
        Self(child)
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        if let Some(c) = &mut self.0 {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

struct Running {
    id: String,
    cancel: Arc<Cancel>,
    thread: Option<JoinHandle<()>>,
    /// 終わり（完了・失敗）を知らせた。あとはスレッドが片付けて抜けるだけ
    ending: Arc<AtomicBool>,
}

pub struct Engine {
    pub paths: Paths,
    pub events: Arc<dyn Events>,
    job: Mutex<Option<Running>>,
    pub(crate) download: Mutex<Option<Arc<Cancel>>>,
    /// 画面の言語（約束 版7）。保存するファイルの中の言葉と、既定の保存先の名前に使う
    locale: Mutex<Lang>,
    /// 画面で最後に見た録音（開いた・名前付け・結果・行の再生）。掃除でその音声を消さない（tidy.rs）
    viewing: Mutex<Option<String>>,
    /// 行の再生のための音声の取り出し（同じ録音を2つ同時に取り出さない）
    pub(crate) audio_lock: Mutex<()>,
}

/// 突き合わせの段階の目安（秒）: 録音 1 時間あたり数秒
fn merge_estimate(duration: f64) -> f64 {
    3.0 + duration * 0.002
}

struct Ctx<'a> {
    engine: &'a Engine,
    job: JobDir,
    source: PathBuf,
    cancel: Arc<Cancel>,
    t0: Instant,
    reused: bool,
    last_emit: Mutex<Option<Instant>>,
}

impl Ctx<'_> {
    fn emit(&self, stage: Stage, percent: Option<f64>, eta: Option<f64>, force: bool) {
        let mut last = self.last_emit.lock().unwrap();
        if !force && last.is_some_and(|t| t.elapsed().as_secs_f64() < 1.0) {
            return;
        }
        *last = Some(Instant::now());
        self.engine.events.job_progress(&JobProgress {
            job_id: self.job.id.clone(),
            stage,
            stage_percent: percent.map(|p| pycompat::round(p.clamp(0.0, 100.0), 1)),
            eta_sec: eta.map(|e| e.max(0.0).round() as u64),
            elapsed_sec: self.t0.elapsed().as_secs(),
            reused_diarization: self.reused,
        });
    }

    fn log(&self, msg: &str) {
        log::write(&self.engine.paths, &format!("job {} {msg}", self.job.id));
    }
}

impl Engine {
    pub fn new(paths: Paths, events: Arc<dyn Events>) -> Arc<Self> {
        let locale = remembered_locale(&paths).unwrap_or_default();
        Arc::new(Self {
            paths,
            events,
            job: Mutex::new(None),
            download: Mutex::new(None),
            locale: Mutex::new(locale),
            viewing: Mutex::new(None),
            audio_lock: Mutex::new(()),
        })
    }

    /// 処理を始める（別のスレッドで進め、途中経過・終わり・失敗はイベントで知らせる）。同時に動かすのは1本だけ
    pub fn start_job(self: &Arc<Self>, path: &Path) -> Result<JobStarted, AppError> {
        let (id, src) = identify(path)?;
        let mut slot = self.job.lock().unwrap();
        if let Some(r) = slot.as_mut() {
            if r.thread.as_ref().is_some_and(|t| !t.is_finished()) {
                // 終わりを知らせたあと片付けている最中なら、抜けるのを待つ（画面は終わりの知らせを受けてすぐ順番待ちの次を始める）
                if !r.ending.load(Ordering::SeqCst) {
                    return Err(AppError::engine_failed().with_detail("ほかの処理が動いている"));
                }
                if let Some(t) = r.thread.take() {
                    let _ = t.join();
                }
            }
        }
        // 別の録音を始めたら、それまでの録音の取り出した音声と行の再生の切り抜きを消す（使い終えた。tidy.rs）。
        // 画面で見ている録音には触らない（処理中にほかの録音を開ける形なので、見ている録音の行の再生が鳴らなくなる）
        let viewing = self.viewing_id();
        let keep: Vec<&str> = [Some(id.as_str()), viewing.as_deref()].into_iter().flatten().collect();
        let t = tidy::tidy_jobs(&self.paths, &keep);
        if !t.is_empty() {
            log::write(&self.paths, &tidy::describe(&t));
        }
        let job = JobDir { id: id.clone(), dir: self.paths.jobs().join(&id) };
        fs::create_dir_all(&job.dir).map_err(|e| io_error(&e, "作業フォルダ"))?;
        let mut src = src;
        if let Ok(old) = job.source() {
            src.duration_sec = old.duration_sec;
        }
        write_json(&job.file("source.json"), &src)?;
        let out_dir = default_out_dir(Path::new(&src.path)).display().to_string();
        let cancel = Arc::new(Cancel::new());
        let ending = Arc::new(AtomicBool::new(false));
        let me = Arc::clone(self);
        let (c2, e2, j2, source) = (Arc::clone(&cancel), Arc::clone(&ending), job.clone(), PathBuf::from(&src.path));
        let thread = std::thread::spawn(move || me.run(j2, source, c2, e2));
        *slot = Some(Running { id: id.clone(), cancel, thread: Some(thread), ending });
        Ok(JobStarted { job_id: id, out_dir })
    }

    /// 中止する（onJobFailed に code "cancelled" が届く）
    pub fn cancel_job(&self, job_id: &str) {
        if let Some(r) = self.job.lock().unwrap().as_ref() {
            if r.id == job_id {
                r.cancel.cancel();
            }
        }
    }

    /// 動いている処理とダウンロードを止める（アプリを閉じるとき）
    pub fn shutdown(&self) {
        if let Some(r) = self.job.lock().unwrap().as_ref() {
            r.cancel.cancel();
        }
        if let Some(c) = self.download.lock().unwrap().as_ref() {
            c.cancel();
        }
    }

    /// アプリを終えるとき: 動いている処理とダウンロードを止め、処理が止まるのを wait まで待ってから、
    /// 取り出した音声と行の再生の切り抜きを消す（tidy.rs。止まりきらなかった録音には触らず、次に開いたときに消す）
    pub fn finish(&self, wait: Duration) {
        self.shutdown();
        let deadline = Instant::now() + wait;
        let busy = loop {
            let running = self.job.lock().unwrap().as_ref().and_then(|r| {
                r.thread.as_ref().is_some_and(|t| !t.is_finished()).then(|| r.id.clone())
            });
            match running {
                Some(id) if Instant::now() >= deadline => break Some(id),
                Some(_) => std::thread::sleep(Duration::from_millis(50)),
                None => break None,
            }
        };
        let keep: Vec<&str> = busy.as_deref().into_iter().collect();
        let t = tidy::tidy_jobs(&self.paths, &keep);
        if !t.is_empty() {
            log::write(&self.paths, &tidy::describe(&t));
        }
    }

    /// アプリを開いたとき: 前の置き場所（Caches）の作業フォルダを移し（1回だけ。history.rs）、前に消し損ねた音声と切り抜きを消す（tidy.rs）。
    /// 作業フォルダ（履歴）は丸ごとは消さない。画面が処理を始める前に呼ぶ（取り出し途中のファイルを消さないように）
    pub fn tidy_on_start(&self) -> (crate::history::Migrated, tidy::Tidied) {
        let m = crate::history::migrate_legacy_jobs(&self.paths);
        if !m.is_empty() {
            log::write(&self.paths, &m.describe());
        }
        let t = tidy::tidy_jobs(&self.paths, &[]);
        if !t.is_empty() {
            log::write(&self.paths, &tidy::describe(&t));
        }
        (m, t)
    }

    /// 画面の言語（約束 版7）。画面が知らせる前は、前に知らせた言語（無ければ日本語。外枠が Mac の言語で決め直す）
    pub fn locale(&self) -> Lang {
        *self.locale.lock().unwrap()
    }

    /// 画面の言語にする（約束 版7 の setLocale）。remember なら次に開いたときのために覚える
    /// （外枠がメニューを最初からその言語で作れるように）。変わったら true
    pub fn set_locale(&self, lang: Lang, remember: bool) -> bool {
        let changed = std::mem::replace(&mut *self.locale.lock().unwrap(), lang) != lang;
        if remember && remembered_locale(&self.paths) != Some(lang) {
            let _ = fs::create_dir_all(&self.paths.app_data);
            let _ = fs::write(self.paths.app_data.join(LOCALE_FILE), lang.as_str());
        }
        changed
    }

    /// 処理中か（処理中に窓を閉じようとしたら確かめる。約束 版5）
    pub fn is_busy(&self) -> bool {
        self.running_id().is_some()
    }

    /// 処理中の録音の ID（履歴の一覧に出さない・消させない・掃除しない）
    pub fn running_id(&self) -> Option<String> {
        self.job.lock().unwrap().as_ref().and_then(|r| r.thread.as_ref().is_some_and(|t| !t.is_finished()).then(|| r.id.clone()))
    }

    /// 画面で最後に見た録音（掃除でその音声を消さない）
    pub fn viewing_id(&self) -> Option<String> {
        self.viewing.lock().unwrap().clone()
    }

    /// 画面がこの録音を見ている（開いた・名前付け・結果・行の再生のたびに呼ぶ）
    pub fn set_viewing(&self, job_id: &str) {
        let mut v = self.viewing.lock().unwrap();
        if v.as_deref() != Some(job_id) {
            *v = Some(job_id.to_string());
        }
    }

    /// 処理が終わるまで待つ（画面なしのコマンド用）
    pub fn wait(&self) {
        let t = self.job.lock().unwrap().as_mut().and_then(|r| r.thread.take());
        if let Some(t) = t {
            let _ = t.join();
        }
    }

    fn run(&self, job: JobDir, source: PathBuf, cancel: Arc<Cancel>, ending: Arc<AtomicBool>) {
        let _awake = KeepAwake::start();
        let ctx = Ctx { engine: self, job, source, cancel, t0: Instant::now(), reused: false, last_emit: Mutex::new(None) };
        // 録音の名前と場所はログに書かない（形式と大きさだけ。ログを Issue に貼ってもよいように）
        let ext = ctx.source.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let mb = fs::metadata(&ctx.source).map(|m| m.len() as f64 / 1e6).unwrap_or(0.0);
        ctx.log(&format!("開始（.{ext}・{mb:.1}MB）"));
        let result = self.pipeline(ctx);
        match result {
            Ok((ctx, done)) => {
                set_status(&ctx.job, "done");
                ctx.log(&format!("完了 {:.1} 秒", ctx.t0.elapsed().as_secs_f64()));
                ending.store(true, Ordering::SeqCst);
                self.events.job_done(&done);
            }
            Err((job, e)) => {
                let kept = job.diarization().is_file();
                let error = if e.is_cancelled() { AppError::cancelled(kept) } else { e };
                set_status(&job, if error.is_cancelled() { "cancelled" } else { "failed" });
                log::write(&self.paths, &format!("job {} 失敗 {error}", job.id));
                ending.store(true, Ordering::SeqCst);
                self.events.job_failed(&JobFailed { job_id: job.id.clone(), error, diarization_kept: kept });
            }
        }
    }

    #[allow(clippy::result_large_err)]
    fn pipeline<'a>(&'a self, mut ctx: Ctx<'a>) -> Result<(Ctx<'a>, JobDone), (JobDir, AppError)> {
        macro_rules! tryj {
            ($e:expr) => {
                match $e {
                    Ok(v) => v,
                    Err(e) => return Err((ctx.job.clone(), e)),
                }
            };
        }
        let paths = &self.paths;
        let audio = ctx.job.audio();

        // 1. 音声の取り出し（前回の WAV があれば使う）
        ctx.emit(Stage::Extract, None, None, true);
        let mut duration = tryj!(ctx.job.source()).duration_sec;
        if !(audio.is_file() && duration > 0.0) {
            let info = tryj!(engines::inspect(paths, &ctx.source));
            let need = (info.duration_sec * 32000.0) as u64 + 200_000_000;
            if let Some(free) = free_bytes(&ctx.job.dir) {
                if free < need {
                    return Err((ctx.job.clone(), AppError::disk_full(need - free)));
                }
            }
            let tmp = ctx.job.file("audio.part.wav");
            duration = tryj!(engines::decode(paths, &ctx.source, &tmp, &ctx.cancel));
            tryj!(fs::rename(&tmp, &audio).map_err(|e| io_error(&e, "audio.wav")));
            let mut src = tryj!(ctx.job.source());
            src.duration_sec = duration;
            tryj!(write_json(&ctx.job.file("source.json"), &src));
            ctx.log(&format!("取り出し {:.1} 秒（録音 {:.1} 分）", ctx.t0.elapsed().as_secs_f64(), duration / 60.0));
        }

        // 2. 話者判定（前回の結果があれば使い回す）
        let diar_path = ctx.job.diarization();
        let turns: Vec<Turn> = if diar_path.is_file() {
            ctx.reused = true;
            ctx.emit(Stage::Diarize, None, None, true);
            tryj!(merge::load_json::<Vec<Turn>>(&diar_path).map_err(|e| io_error(&e, "diarization.json")))
        } else {
            ctx.emit(Stage::Diarize, None, None, true);
            let t = Instant::now();
            let raw = ctx.job.file("diarization.raw.json");
            tryj!(engines::diarize(paths, &audio, &raw, &ctx.cancel, |_| {}));
            let text = tryj!(fs::read_to_string(&raw).map_err(|e| io_error(&e, "diarization.raw.json")));
            let turns = tryj!(diar::to_turns(&text).map_err(|e| io_error(&e, "話者判定の出力")));
            tryj!(write_json(&diar_path, &turns));
            ctx.log(&format!("話者判定 {:.1} 秒・区間 {}", t.elapsed().as_secs_f64(), turns.len()));
            turns
        };

        // 3. 書き起こし。進み具合は whisper-cli の -pp（5% ごと）で、刻みの間は1秒ごとに、これまでの速さから埋めた％を送る
        // （次の刻みは超えない）。whisper-cli の標準出力の区切りは使わない（--dtw のとき whisper.cpp v1.9.4 の不具合で、
        // 区切りの知らせが書き始めの 1〜2 分だけ・重複して出る）。繰り返しは書き起こしが終わってから JSON で見つける（知らせて続ける）。
        // 90 分を超える録音は、無音の所で約 1 時間ずつに分けて書き、中止しても書き終えた部分から再開する（chunk_plan）
        // 段階の始まりの知らせは transcribe_plan の最初の知らせ（再開なら書き終えた分の％。％は戻らない）
        let (over, size) = chunk_limits();
        let plan = chunk_plan(duration, &turns, over, size);
        tryj!(prepare_asr(paths, &ctx.job, &plan));
        let t_tr = Instant::now();
        // 最後に届いた全体の％・その時刻・次の刻みまでの幅（全体の％）。base はこの回に始めたときの％（再開なら書き終えた分）
        let step = Mutex::new((0.0_f64, Instant::now(), 4.9_f64));
        let base = Mutex::new(0.0_f64);
        let progress = |ctx: &Ctx, force: bool| {
            let (p0, at, gap) = *step.lock().unwrap();
            let b = *base.lock().unwrap();
            let el0 = at.duration_since(t_tr).as_secs_f64();
            let rate = if p0 > b && el0 > 0.0 { (p0 - b) / el0 } else { 0.0 }; // ％／秒
            let p = if rate > 0.0 { (p0 + rate * at.elapsed().as_secs_f64()).min(p0 + gap).min(99.9) } else { p0 };
            // 残り時間は、この回の書き起こしが 5% 以上・20 秒以上進んでから（序盤の速さはあてにならない）
            let eta = (p0 - b >= 5.0 && el0 >= 20.0 && rate > 0.0).then(|| (100.0 - p) / rate + merge_estimate(duration));
            ctx.emit(Stage::Transcribe, Some(p), eta, force);
        };
        // 1 秒ごとに進み具合を送る見張りは、書き起こしが終わったら（stop を落としたら）すぐに抜ける
        // （前は 1 秒眠ってから終わりを見ていたので、書き起こしを使い回すときも 1 秒待っていた）
        let (stop, stopped) = std::sync::mpsc::channel::<()>();
        let segs = std::thread::scope(|sc| {
            let (ctx, progress) = (&ctx, &progress);
            sc.spawn(move || {
                while let Err(std::sync::mpsc::RecvTimeoutError::Timeout) =
                    stopped.recv_timeout(std::time::Duration::from_millis(1000))
                {
                    progress(ctx, false);
                }
            });
            let r = transcribe_plan(paths, &ctx.job, &audio, duration, &plan, &ctx.cancel, |pr| {
                *base.lock().unwrap() = pr.resumed_from;
                *step.lock().unwrap() = (pr.overall, Instant::now(), pr.gap);
                progress(ctx, true);
            });
            drop(stop);
            r
        });
        let segs = tryj!(segs);
        let tr_sec = t_tr.elapsed().as_secs_f64();
        let resumed = *base.lock().unwrap();
        if resumed >= 99.9 {
            ctx.log(&format!("書き起こし 前回のものを使った（{tr_sec:.1} 秒・{} つに分けた）", plan.len()));
        } else {
            ctx.log(&format!("書き起こし {tr_sec:.1} 秒（録音の {:.2} 倍・{} つに分けた）", tr_sec / duration.max(1.0), plan.len()));
        }
        // この Mac の速さの記録は、最初から書き起こしたときだけ（使い回し・続きからは速さにならない）
        if duration >= 300.0 && resumed == 0.0 {
            save_speed(paths, tr_sec / duration);
        }

        // 4. 突き合わせ（画面向けの一式を作業フォルダに作る。組み立ては core の kikiwake-dev screen と同じ）
        ctx.emit(Stage::Merge, None, Some(merge_estimate(duration)), true);
        let repeats = repeat::find_repeats(&segs);
        for r in &repeats {
            ctx.log(&format!("繰り返しを検出: {}", repeat::describe(r)));
        }
        let words_p = whisper::to_words(&segs);
        tryj!(write_json(&ctx.job.file("words.json"), &words_p));
        let words: Vec<Word> = words_p.iter().map(|w| Word { start: w.start, end: w.end, word: w.word.clone() }).collect();
        let src = tryj!(ctx.job.source());
        let meta = Meta {
            title: ctx.source.file_stem().map(|s| s.to_string_lossy().into_owned()),
            source: Some(src.path.clone()),
            duration: Some(duration),
            diarizer: Some(DIARIZER_NAME.into()),
            asr: Some(ASR_NAME.into()),
            created: Some(today()),
            audio: Some(audio.display().to_string()),
        };
        tryj!(write_json(&ctx.job.file("meta.json"), &meta));
        let out = tryj!(build_views(&ctx.job, &words, &turns, &meta, &repeats));
        ctx.log(&format!("突き合わせ 話者 {}・確認用 {}・繰り返し {}", out.0, out.1, repeats.len()));
        let done = JobDone {
            job_id: ctx.job.id.clone(),
            // 既定の保存先は元ファイルと同じフォルダ（約束 版12）
            out_dir: default_out_dir(&ctx.source).display().to_string(),
            speakers: out.0,
            unresolved_count: out.1,
            names: crate::results::names_of(&ctx.job),
            // 版8: 閉じたときの状態（書き起こしが変わっていなければ）
            draft: crate::history::load_draft(&ctx.job),
        };
        Ok((ctx, done))
    }
}

// ---- 長い録音を分けて書き起こす ----------------------------------------------------------------

/// 90 分を超える録音は、無音の所で約 1 時間ずつに分けて書き起こす（2026-09-26 決定）。
/// 分けないと、whisper-cli が始めに音声全体と特徴量を読み込むのでメモリが録音の長さとともに増え（68 分 4.8GB・4.5 時間 7.3GB）、
/// 録音の 2 時間 46 分 40 秒より後の語の時刻（t_dtw）が有効数字 6 桁の指数表記で書き出されて 100ms 刻みになる。
/// 分けると書き起こしの文字は分けない場合から数% 変わる（whisper は録音全体の音量で特徴量をそろえるため。実録音 20 分で 6.2%、
/// 合成会議の文字の誤り率 2.84% → 3.09%。Phase 2 の測定）。90 分以下の録音は分けない（今までどおり）
pub const CHUNK_OVER_SEC: f64 = 90.0 * 60.0;
pub const CHUNK_SEC: f64 = 60.0 * 60.0;
/// 境目を探す幅（均等に分けた位置の前後）
const CHUNK_SEARCH_SEC: f64 = 5.0 * 60.0;

/// 確かめ用に環境変数で短くできる（KIKIWAKE_CHUNK_OVER_SEC・KIKIWAKE_CHUNK_SEC）
fn chunk_limits() -> (f64, f64) {
    let env = |k: &str, d: f64| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
    (env("KIKIWAKE_CHUNK_OVER_SEC", CHUNK_OVER_SEC), env("KIKIWAKE_CHUNK_SEC", CHUNK_SEC))
}

/// 書き起こしの分け方 [(開始秒, 終了秒)]。均等に分けた位置の前後から、誰も話していない（話者区間の和集合の隙間）
/// いちばん長い所の真ん中を選ぶ。無ければ均等の位置。境目は 10ms 単位（whisper の t_dtw の単位）
pub fn chunk_plan(duration: f64, turns: &[Turn], over: f64, size: f64) -> Vec<(f64, f64)> {
    if duration <= over || size <= 0.0 {
        return vec![(0.0, duration)];
    }
    let n = ((duration / size).ceil() as usize).max(2);
    let len = duration / n as f64;
    let search = (len / 4.0).min(CHUNK_SEARCH_SEC);
    let mut spans: Vec<(f64, f64)> = turns.iter().map(|t| (t.start, t.end)).collect();
    spans.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (a, b) in spans {
        match merged.last_mut() {
            Some(l) if a <= l.1 => l.1 = l.1.max(b),
            _ => merged.push((a, b)),
        }
    }
    let gaps: Vec<(f64, f64)> = merged.windows(2).map(|w| (w[0].1, w[1].0)).collect();
    let mut cuts = vec![0.0];
    for k in 1..n {
        let target = len * k as f64;
        let best = gaps
            .iter()
            .filter(|g| ((g.0 + g.1) / 2.0 - target).abs() <= search)
            .max_by(|a, b| (a.1 - a.0).partial_cmp(&(b.1 - b.0)).unwrap_or(std::cmp::Ordering::Equal));
        let at = best.map(|g| (g.0 + g.1) / 2.0).unwrap_or(target);
        cuts.push((at * 100.0).round() / 100.0);
    }
    cuts.push(duration);
    cuts.windows(2).map(|w| (w[0], w[1])).collect()
}

/// 書き起こしの進み具合
pub struct TrProgress {
    /// 全体の％（0〜100）
    pub overall: f64,
    /// 次の刻み（whisper-cli の -pp の 5%）までの幅（全体の％）
    pub gap: f64,
    /// この回に始めたときの全体の％（中止のあと再開したなら、前に書き終えた部分）
    pub resumed_from: f64,
}

/// 区切りの時刻を ms だけずらす（分けた部分の時刻を元の録音の時刻に直す）。t_dtw は 10ms 単位
fn shift(seg: &mut whisper::Segment, ms: i64) {
    seg.offsets.from += ms;
    seg.offsets.to += ms;
    for t in &mut seg.tokens {
        t.offsets.from += ms;
        t.offsets.to += ms;
        if t.t_dtw >= 0 {
            t.t_dtw += ms / 10;
        }
    }
}

fn read_segments(json: &Path) -> Result<Vec<whisper::Segment>, AppError> {
    let text = fs::read_to_string(json).map_err(|e| io_error(&e, &json.display().to_string()))?;
    whisper::parse_ojf(&text).map_err(|e| AppError::engine_failed().with_detail(format!("{}: {e}", json.display())))
}

/// 分け方どおりに書き起こし、元の録音の時刻の区切りの並びを返す。分けないときは asr.json、分けたときは asr_<n>.json
/// （分け方は asr_plan.json に残し、同じ分け方で書き終えた部分は書き直さない）
fn transcribe_plan(
    paths: &Paths,
    job: &JobDir,
    audio: &Path,
    duration: f64,
    plan: &[(f64, f64)],
    cancel: &Cancel,
    mut on_progress: impl FnMut(TrProgress) + Send,
) -> Result<Vec<whisper::Segment>, AppError> {
    if plan.len() == 1 {
        let json = job.file("asr.json");
        if json.is_file() {
            // 版6: 同じ設定で書き終えた書き起こしを使い回す（prepare_asr が設定の違うものは消してある）。読めなければ書き直す
            on_progress(TrProgress { overall: 100.0, gap: 0.0, resumed_from: 100.0 });
            match read_segments(&json) {
                Ok(segs) => return Ok(segs),
                Err(_) => {
                    let _ = fs::remove_file(&json);
                }
            }
        }
        on_progress(TrProgress { overall: 0.0, gap: 4.9, resumed_from: 0.0 });
        let part = engines::transcribe(paths, audio, &job.file("asr.part"), cancel, |p| {
            on_progress(TrProgress { overall: p, gap: 4.9, resumed_from: 0.0 })
        })?;
        fs::rename(&part, &json).map_err(|e| io_error(&e, "asr.json"))?;
        return read_segments(&json);
    }
    let plan_path = job.file("asr_plan.json");
    let old: Option<Vec<(f64, f64)>> = merge::load_json(&plan_path).ok();
    let chunk_json = |i: usize| job.file(&format!("asr_{i:02}.json"));
    if old.as_deref() != Some(plan) {
        for i in 0..100 {
            let _ = fs::remove_file(chunk_json(i));
        }
        write_json(&plan_path, plan)?;
    }
    let total = duration.max(1.0);
    let resumed_from: f64 = plan.iter().enumerate().filter(|(i, _)| chunk_json(*i).is_file()).map(|(_, (s, e))| (e - s) / total * 100.0).sum();
    // 書き終えた部分があれば、始めにそれを知らせる（全部そろっていると下で一度も知らせないので、
    // 知らせないと「最初から書き起こした」と見なされ、この Mac の速さの記録をほぼ 0 で上書きしていた）
    if resumed_from > 0.0 {
        on_progress(TrProgress { overall: resumed_from.min(100.0), gap: 0.0, resumed_from });
    }
    let mut done = 0.0;
    let mut all = Vec::new();
    for (i, &(s, e)) in plan.iter().enumerate() {
        let weight = (e - s) / total;
        if !chunk_json(i).is_file() {
            on_progress(TrProgress { overall: done, gap: (4.9 * weight).max(0.01), resumed_from });
            let wav = job.file("asr_chunk.wav");
            wav::cut(audio, s, e, &wav, 0.0, e - s + 0.001).map_err(|er| io_error(&er, "書き起こしの部分の WAV"))?;
            let stem = job.file(&format!("asr_{i:02}.part"));
            let r = engines::transcribe(paths, &wav, &stem, cancel, |p| {
                on_progress(TrProgress { overall: done + p * weight, gap: (4.9 * weight).max(0.01), resumed_from })
            });
            let _ = fs::remove_file(&wav);
            let json = r?;
            fs::rename(&json, chunk_json(i)).map_err(|er| io_error(&er, "書き起こしの部分"))?;
        }
        let mut segs = read_segments(&chunk_json(i))?;
        let ms = (s * 1000.0).round() as i64;
        for seg in &mut segs {
            shift(seg, ms);
        }
        all.extend(segs);
        done += weight * 100.0;
    }
    Ok(all)
}

// ---- 書き起こしの使い回し（版6。2026-09-26 決定） ---------------------------------------------
// 同じ録音をもう一度始めたとき、同じ設定で書き終えた書き起こしがあれば、書き起こしをやり直さずに1秒ほどで名前付けへ進む
// （今までは 90 分以下の録音は書き起こしからやり直していた。68 分で約 15 分）

/// 書き起こしの設定の目印（whisper-cli の中身・引数・モデルの大きさ）。アプリの更新でエンジンや設定が変わったら、前の書き起こしは使わない
pub fn asr_settings(paths: &Paths) -> String {
    let cli = paths
        .engine("whisper-cli")
        .ok()
        .and_then(|p| fs::read(p).ok())
        .map(|b| Sha256::digest(&b).iter().take(8).map(|x| format!("{x:02x}")).collect::<String>())
        .unwrap_or_default();
    let model = fs::metadata(paths.models.join(engines::ASR_MODEL_FILE)).map(|m| m.len()).unwrap_or(0);
    format!("whisper-cli {cli} / {} {model} / {}", engines::ASR_MODEL_FILE, engines::ASR_ARGS.join(" "))
}

/// 書き起こしを書き終えているか（今の分け方で、全部の部分がそろっている）
fn asr_complete(job: &JobDir, plan: &[(f64, f64)]) -> bool {
    if plan.len() == 1 {
        return job.file("asr.json").is_file();
    }
    merge::load_json::<Vec<(f64, f64)>>(&job.file("asr_plan.json")).ok().as_deref() == Some(plan)
        && (0..plan.len()).all(|i| job.file(&format!("asr_{i:02}.json")).is_file())
}

/// 書き起こしを始める前に: 設定の目印が前と違い、まだ書き終えていなければ、書きかけ（asr.json・分けたもの）を消して、今の目印を書く。
/// 書き終えた書き起こしは、設定の目印が違っても（アプリを更新してエンジンを作り直しても）そのまま使う（2026-09-27。
/// 作業フォルダは履歴なので、更新のたびに開き直すと書き起こしをやり直す（68 分で約 15 分・手直しも合わなくなる）のを避ける）。
/// 目印のファイルは、書き起こしたときのエンジンの記録として残す
fn prepare_asr(paths: &Paths, job: &JobDir, plan: &[(f64, f64)]) -> Result<(), AppError> {
    let now = asr_settings(paths);
    let same = fs::read_to_string(job.file("asr_settings.txt")).ok().as_deref() == Some(now.as_str());
    if !same && !asr_complete(job, plan) {
        let _ = fs::remove_file(job.file("asr.json"));
        let _ = fs::remove_file(job.file("asr_plan.json"));
        for i in 0..100 {
            let _ = fs::remove_file(job.file(&format!("asr_{i:02}.json")));
        }
        fs::write(job.file("asr_settings.txt"), &now).map_err(|e| io_error(&e, "asr_settings.txt"))?;
    }
    Ok(())
}

/// 前回の書き起こしを書き終えていて、始めると書き起こしをやり直さずに済むか（ファイルの確認で画面に知らせる。FileInfo.previous.resultReusable）。
/// 書き終えていれば、設定の目印が違っても（アプリを更新しても）使う（prepare_asr と同じ。2026-09-27）
pub fn transcript_reusable(_paths: &Paths, job: &JobDir) -> bool {
    // 取り出した音声は、使い終えたら消している（tidy.rs）。始めると元の録音から取り出し直す（68 分の録音で 1.2 秒）ので、ここでは見ない
    let (Ok(src), Ok(turns)) = (job.source(), merge::load_json::<Vec<Turn>>(&job.diarization())) else {
        return false;
    };
    if src.duration_sec <= 0.0 {
        return false;
    }
    let (over, size) = chunk_limits();
    asr_complete(job, &chunk_plan(src.duration_sec, &turns, over, size))
}

fn set_status(job: &JobDir, status: &str) {
    if let Ok(mut s) = job.source() {
        s.status = status.into();
        s.processed_at = today();
        let _ = write_json(&job.file("source.json"), &s);
    }
}

/// 繰り返しの記録（repeats.json。調べる用で、読み戻さない）。範囲のうち人が話していた秒数も付ける
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatRecord {
    pub start_sec: f64,
    pub end_sec: f64,
    pub speech_sec: f64,
    pub describe: String,
    pub detail: Repeat,
}

/// 画面向けの一式（話者カードとサンプル音声・確認用の手がかり・ラベル版の結果・繰り返し）を作る。返すのは（話者の数, 確認用の件数）
pub fn build_views(job: &JobDir, words: &[Word], turns: &[Turn], meta: &Meta, repeats: &[Repeat]) -> Result<(usize, usize), AppError> {
    let audio = job.audio();
    let sdir = job.samples();
    let _ = fs::remove_dir_all(&sdir);
    fs::create_dir_all(&sdir).map_err(|e| io_error(&e, "samples"))?;
    let prefix = format!("{}/", sdir.display());
    let utts = merge::build_transcript(words, turns, None, 1.0, 1.5);
    let cards = view::speaker_cards(&utts, turns, &audio, &sdir, &prefix).map_err(|e| io_error(&e, "話者カード"))?;
    write_json(&job.file("speakers.json"), &cards)?;
    let hints = unresolved::unresolved_hints(words, turns, Some(audio.as_path()), Some(sdir.as_path()), &prefix)
        .map_err(|e| io_error(&e, "確認用の手がかり"))?;
    write_json(&job.file("unresolved_hints.json"), &hints)?;
    let tt = merge::talk_time(turns, None);
    let plain: Vec<lines::Line> = lines::lines(words, turns, None).into_iter().map(|r| r.line).collect();
    let v = view::transcript_view(&plain, &tt, meta, meta.duration.unwrap_or(0.0), false);
    write_json(&job.file("view_transcript.json"), &v)?;
    let recs: Vec<RepeatRecord> = repeats
        .iter()
        .map(|r| {
            let (s, e) = r.range();
            RepeatRecord {
                start_sec: s,
                end_sec: e,
                speech_sec: pycompat::round(repeat::speech_seconds(s, e, turns), 1),
                describe: repeat::describe(r),
                detail: r.clone(),
            }
        })
        .collect();
    write_json(&job.file("repeats.json"), &recs)?;
    write_json(&job.file("repeat_notices.json"), &repeat_notices(repeats, turns, meta.duration.unwrap_or(0.0)))?;
    Ok((merge::label_map(turns).len(), v.unresolved.len()))
}

/// 画面で知らせる繰り返し（版4）。重なる・つながる範囲は1つにまとめ、人が話していた部分を上書きしたものだけにする
/// （人が話していたのが 10 秒以上、かつ範囲の 2 割以上）。無音の部分の誤認識の繰り返しは確認用の欄に回っていて本文に入らないので知らせない。
/// 実測: Phase 0 の壊れた書き起こしは範囲の 87% が人の発言（2,584 秒）、実録音 68 分の最後の無音の誤認識は 5 分の窓で 9.2 秒（3%）
pub fn repeat_notices(repeats: &[Repeat], turns: &[Turn], duration: f64) -> Vec<RepeatNotice> {
    // 1 件ずつ人の発言を上書きしたかを見てから、重なる・つながる範囲をまとめる（無音の窓が隣にあっても範囲を伸ばさない）。
    // 5 分ごとの窓の検出は区切りが粗いので、同じ文の繰り返し（区切りが正確）と重なる窓は外す
    // （Phase 0 の壊れた書き起こしで、知らせの始まりが実際の 0:16:43 でなく窓の 0:15:00 になった）
    let overwrote = |s: f64, e: f64| {
        let speech = repeat::speech_seconds(s, e, turns);
        speech >= 10.0 && speech >= 0.2 * (e - s)
    };
    let same: Vec<(f64, f64)> =
        repeats.iter().filter(|r| matches!(r, Repeat::SameText { .. })).map(Repeat::range).collect();
    let mut spans: Vec<(f64, f64)> = repeats
        .iter()
        .filter(|r| !matches!(r, Repeat::Window { start, end, .. } if same.iter().any(|&(a, b)| *start < b && a < *end)))
        .map(Repeat::range)
        .filter(|&(s, e)| overwrote(s, e))
        .collect();
    spans.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (s, e) in spans {
        match merged.last_mut() {
            Some(last) if s <= last.1 + 1.0 => last.1 = last.1.max(e),
            _ => merged.push((s, e)),
        }
    }
    let long = duration >= 3600.0; // 結果の行と同じ時刻の書き方（1 時間以上なら h:mm:ss）
    merged
        .into_iter()
        .map(|(s, e)| {
            let e = if duration > 0.0 { e.min(duration) } else { e };
            RepeatNotice {
                start_sec: pycompat::round(s, 2),
                end_sec: pycompat::round(e, 2),
                speech_sec: pycompat::round(repeat::speech_seconds(s, e, turns), 1),
                message: format!(
                    "{}〜{} の書き起こしは、同じ文の繰り返しになっていて読めません",
                    merge::fmt_ts(s, long),
                    merge::fmt_ts(e, long)
                ),
            }
        })
        .collect()
}

#[allow(dead_code)]
fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
impl Engine {
    /// テスト用: id の録音を処理中にする（返した送り口を落とすと処理が終わる）。ending は「終わりを知らせて片付けている」
    pub(crate) fn fake_running(&self, id: &str, ending: bool) -> std::sync::mpsc::Sender<()> {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let thread = std::thread::spawn(move || {
            let _ = rx.recv();
        });
        *self.job.lock().unwrap() =
            Some(Running { id: id.into(), cancel: Arc::new(Cancel::new()), thread: Some(thread), ending: Arc::new(AtomicBool::new(ending)) });
        tx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(a: f64, b: f64) -> Turn {
        Turn { start: a, end: b, speaker: "speaker_0".into() }
    }

    #[test]
    fn repeat_notices_only_when_speech_was_overwritten() {
        let turns = vec![turn(900.0, 3000.0), turn(3990.0, 3999.2)];
        let repeats = vec![
            // 壊れた書き起こし（人の発言を上書き）と、それに重なる繰り返し度の窓 → 1 つにまとめて知らせる
            Repeat::SameText { start: 1003.0, end: 3963.0, text: "x".into(), count: 1480 },
            Repeat::Window { start: 1200.0, end: 1500.0, rate: 0.99, chars: 400 },
            // 会話が終わったあとの無音の誤認識（5 分の窓で人の発言 9.2 秒）→ 知らせない
            Repeat::Window { start: 3900.0, end: 4200.0, rate: 0.78, chars: 250 },
        ];
        let n = repeat_notices(&repeats, &turns, 4200.0);
        assert_eq!(n.len(), 1);
        assert_eq!((n[0].start_sec, n[0].end_sec), (1003.0, 3963.0)); // 窓（1200〜1500）は同じ文の繰り返しと重なるので外す
        // 同じ文の繰り返しが無い所の窓は残る（同じではないが似た文の繰り返し）
        let only_window = vec![Repeat::Window { start: 1200.0, end: 1500.0, rate: 0.9, chars: 400 }];
        assert_eq!(repeat_notices(&only_window, &turns, 4200.0).len(), 1);
        assert_eq!(n[0].message, "0:16:43〜1:06:03 の書き起こしは、同じ文の繰り返しになっていて読めません");
    }

    struct NoEvents;
    impl Events for NoEvents {
        fn job_progress(&self, _: &JobProgress) {}
        fn job_done(&self, _: &JobDone) {}
        fn job_failed(&self, _: &JobFailed) {}
        fn model_progress(&self, _: &crate::types::ModelInfo) {}
    }

    #[test]
    fn next_job_waits_for_one_that_has_just_finished_and_keeps_the_viewed_audio() {
        // 画面は終わりの知らせを受けてすぐ順番待ちの次を始める。前の処理が片付けている最中でも断らない（2026-09-27。案A）
        let root = std::env::temp_dir().join(format!("kikiwake-next-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let paths = Paths {
            models: root.join("models"),
            app_data: root.join("app"),
            work: root.join("work"),
            legacy_work: None,
            logs: root.join("logs"),
            engines: root.join("engines"),
        };
        let engine = Engine::new(paths.clone(), Arc::new(NoEvents));
        let rec = root.join("録音/次.m4a");
        fs::create_dir_all(rec.parent().unwrap()).unwrap();
        fs::write(&rec, b"0123456789").unwrap();
        // 画面で見ている録音と、使い終えた録音（どちらも音声を取り出してある）
        for id in ["cccc", "dddd"] {
            fs::create_dir_all(paths.jobs().join(id).join("clips")).unwrap();
            fs::write(paths.jobs().join(id).join("audio.wav"), b"x").unwrap();
            fs::write(paths.jobs().join(id).join("clips/1_2.wav"), b"x").unwrap();
        }
        engine.set_viewing("cccc");
        // まだ動いている（終わりを知らせていない）処理があれば断る
        let busy = engine.fake_running("aaaa", false);
        assert!(engine.start_job(&rec).is_err());
        drop(busy);
        // 終わりを知らせて片付けている最中なら、抜けるのを待ってから始める
        let finishing = engine.fake_running("aaaa", true);
        let t = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            drop(finishing);
        });
        let started = engine.start_job(&rec).unwrap();
        t.join().unwrap();
        assert_eq!(engine.running_id().as_deref().unwrap_or(started.job_id.as_str()), started.job_id);
        // 別の録音を始めても、画面で見ている録音の音声と切り抜きは消さない（行の再生が鳴らなくなるため）
        assert!(paths.jobs().join("cccc/audio.wav").is_file() && paths.jobs().join("cccc/clips/1_2.wav").is_file());
        assert!(!paths.jobs().join("dddd/audio.wav").exists() && !paths.jobs().join("dddd/clips").exists());
        engine.wait(); // エンジンの実行ファイルが無いので、すぐに止まる
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn locale_names_the_saved_files_and_is_remembered() {
        // 既定の保存先は元ファイルと同じフォルダ。保存するファイルの名前は録音の名前入りで、画面の言語で（約束 版12）
        let src = Path::new("/Users/example/定例 9月.m4a");
        assert_eq!(default_out_dir(src), Path::new("/Users/example"));
        assert_eq!(saved_stem(src, Lang::Ja), "定例 9月_文字起こし");
        assert_eq!(saved_stem(src, Lang::En), "定例 9月_transcript");
        assert_eq!(saved_stem(Path::new("/Users/example/ボイスメモ.2026.m4a"), Lang::Ja), "ボイスメモ.2026_文字起こし");

        let root = std::env::temp_dir().join(format!("kikiwake-locale-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let paths = Paths {
            models: root.join("models"),
            app_data: root.join("app"),
            work: root.join("work"),
            legacy_work: None,
            logs: root.join("logs"),
            engines: root.join("engines"),
        };
        // 覚えた言語が無ければ日本語（外枠が Mac の言語で決め直す）。覚えずに変えたら、次に開いたときは元のまま
        let engine = Engine::new(paths.clone(), Arc::new(NoEvents));
        assert_eq!(engine.locale(), Lang::Ja);
        assert!(engine.set_locale(Lang::En, false));
        assert_eq!(remembered_locale(&paths), None);
        // 画面が知らせた言語は覚え、次に開いたときもその言語から
        assert!(!engine.set_locale(Lang::En, true));
        assert_eq!(remembered_locale(&paths), Some(Lang::En));
        assert_eq!(Engine::new(paths.clone(), Arc::new(NoEvents)).locale(), Lang::En);
        // 読めない中身は覚えていない扱い
        fs::write(paths.app_data.join(LOCALE_FILE), "zh").unwrap();
        assert_eq!(remembered_locale(&paths), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reuse_finished_transcripts_even_after_an_update() {
        let root = std::env::temp_dir().join(format!("kikiwake-reuse-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let paths = Paths {
            models: root.join("models"),
            app_data: root.join("app"),
            work: root.join("work"),
            legacy_work: None,
            logs: root.join("logs"),
            engines: root.join("engines"),
        };
        let job = JobDir { id: "ab".into(), dir: paths.jobs().join("ab") };
        fs::create_dir_all(&job.dir).unwrap();
        let source = |duration_sec: f64| Source {
            path: "/x.m4a".into(),
            size_bytes: 1,
            mtime_ns: 1,
            duration_sec,
            processed_at: "2026-09-26".into(),
            status: "done".into(),
        };
        // 取り出しと話者判定まで済んだ 68 分の録音（分けない）
        fs::write(job.audio(), b"RIFF").unwrap();
        write_json(&job.file("source.json"), &source(4068.0)).unwrap();
        write_json(&job.diarization(), &vec![turn(0.0, 4000.0)]).unwrap();
        let single = [(0.0, 4068.0)];
        assert!(!transcript_reusable(&paths, &job)); // 書き起こしがまだ無い
        prepare_asr(&paths, &job, &single).unwrap();
        fs::write(job.file("asr.json"), b"{}").unwrap();
        assert!(transcript_reusable(&paths, &job));
        // 使い終えて取り出した音声を消しても使い回せる（始めると取り出し直す）
        fs::remove_file(job.audio()).unwrap();
        assert!(transcript_reusable(&paths, &job));
        // 設定の目印が変わった（アプリの更新でエンジンを作り直した）: 書き終えた書き起こしはそのまま使う（履歴を開き直すたびに書き直さない）。
        // 目印は書き起こしたときのエンジンの記録として残す
        fs::write(job.file("asr_settings.txt"), "whisper-cli 0000 / 前の設定").unwrap();
        assert!(transcript_reusable(&paths, &job));
        prepare_asr(&paths, &job, &single).unwrap();
        assert!(job.file("asr.json").exists());
        assert_eq!(fs::read_to_string(job.file("asr_settings.txt")).unwrap(), "whisper-cli 0000 / 前の設定");
        // 書き終えていなければ、書きかけは消して今のエンジンで書き直す
        fs::remove_file(job.file("asr.json")).unwrap();
        fs::write(job.file("asr_00.json"), b"{}").unwrap();
        prepare_asr(&paths, &job, &single).unwrap();
        assert!(!job.file("asr_00.json").exists());
        assert_eq!(fs::read_to_string(job.file("asr_settings.txt")).unwrap(), asr_settings(&paths));

        // 4.5 時間の録音（分ける）は、分け方が同じで、分けた部分が全部そろったときだけ
        let turns = vec![turn(0.0, 3200.0), turn(3254.0, 9000.0), turn(9000.5, 16275.0)];
        write_json(&job.file("source.json"), &source(16275.3)).unwrap();
        write_json(&job.diarization(), &turns).unwrap();
        let plan = chunk_plan(16275.3, &turns, CHUNK_OVER_SEC, CHUNK_SEC);
        write_json(&job.file("asr_plan.json"), &plan).unwrap();
        for i in 0..plan.len() - 1 {
            fs::write(job.file(&format!("asr_{i:02}.json")), b"{}").unwrap();
        }
        assert!(!transcript_reusable(&paths, &job)); // 最後の部分がまだ
        fs::write(job.file(&format!("asr_{:02}.json", plan.len() - 1)), b"{}").unwrap();
        assert!(transcript_reusable(&paths, &job));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn short_recordings_are_not_split() {
        assert_eq!(chunk_plan(5400.0, &[], CHUNK_OVER_SEC, CHUNK_SEC), vec![(0.0, 5400.0)]);
    }

    #[test]
    fn long_recordings_split_at_the_longest_silence_near_even_points() {
        // 4.5 時間。1 時間ごとの目安の近くに無音をいくつか置く（いちばん長い無音の真ん中で分ける）
        let dur = 16275.3;
        let turns = vec![turn(0.0, 3200.0), turn(3201.0, 3250.0), turn(3254.0, 3300.0), turn(3302.5, 9000.0), turn(9000.5, 16275.0)];
        let plan = chunk_plan(dur, &turns, CHUNK_OVER_SEC, CHUNK_SEC);
        assert_eq!(plan.len(), 5); // 4.5 時間 ÷ 1 時間 → 5 つ（1 つ約 54 分）
        assert_eq!(plan[0], (0.0, 3252.0)); // 3250〜3254 の 4 秒の無音の真ん中（3201 の 1 秒の無音より長い）
        assert_eq!(plan.last().unwrap().1, dur);
        for w in plan.windows(2) {
            assert_eq!(w[0].1, w[1].0); // すき間も重なりも無い
            assert!(w[0].1 > w[0].0);
        }
        // 無音が見つからない目安の位置は、均等の位置（10ms 単位）
        assert!(plan.iter().all(|(a, _)| ((a * 100.0).round() - a * 100.0).abs() < 1e-6));
    }
}
