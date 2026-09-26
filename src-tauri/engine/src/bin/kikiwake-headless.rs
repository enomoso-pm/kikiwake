//! 画面なしで処理の流れを動かす（Phase 2 手順3・4 の確かめ用。アプリには入らない）。
//! 画面が呼ぶ関数（contract/api.ts）と同じものを呼び、イベントと結果を1行ずつ JSON で出す。
//!
//!   kikiwake-headless env
//!   kikiwake-headless models
//!   kikiwake-headless download [whisper-large-v3 nemotron-3-diarization]   （取り終えるまで待つ）
//!   kikiwake-headless inspect <録音>
//!   kikiwake-headless run <録音> [--cancel-after <秒>]                         （処理が終わるまで待つ）
//!   kikiwake-headless speakers <ID> | hints <ID> | transcript <ID> [--named]
//!   kikiwake-headless names <ID> <names.json>
//!   kikiwake-headless save <ID> <保存先> [md,txt,json] [--overwrite] [--edits <edits.json>]
//!   kikiwake-headless clip <ID> <開始秒> <終了秒>
//!   kikiwake-headless notices <whisper の -ojf JSON> <話者区間の JSON> <録音の長さ（秒）>   （繰り返しの知らせの判定。時刻と秒数だけ出す）
//!
//! 置き場所は環境変数で差し替えられる（KIKIWAKE_MODELS_DIR・KIKIWAKE_CACHE_DIR・KIKIWAKE_ENGINES_DIR）。
//! 実録音で動かしても、出すのは段階・時刻・件数だけ（speakers などの中身を出すのは合成会議のときだけにする）。
use std::path::Path;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};

use kikiwake_engine::types::{Events, JobDone, JobFailed, JobProgress, ModelInfo, ModelState, SaveRequest};
use kikiwake_engine::{env, files, models, results, AppError, Engine, Paths};
use serde::Serialize;
use serde_json::json;

#[derive(Default)]
struct Printer {
    failed: Mutex<bool>,
}

fn line<T: Serialize>(event: &str, v: &T) {
    println!("{}", json!({"event": event, "data": v}));
}

impl Events for Printer {
    fn job_progress(&self, p: &JobProgress) {
        line("job-progress", p);
    }
    fn job_done(&self, d: &JobDone) {
        line("job-done", d);
    }
    fn job_failed(&self, f: &JobFailed) {
        *self.failed.lock().unwrap() = true;
        line("job-failed", f);
    }
    fn model_progress(&self, m: &ModelInfo) {
        line("model-progress", m);
        if m.state == ModelState::Error {
            *self.failed.lock().unwrap() = true;
        }
    }
}

fn out<T: Serialize>(r: Result<T, AppError>) -> ExitCode {
    match r {
        Ok(v) => {
            println!("{}", serde_json::to_string(&v).unwrap());
            ExitCode::SUCCESS
        }
        Err(e) => {
            println!("{}", json!({"error": e}));
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let printer = Arc::new(Printer::default());
    let engine = Engine::new(Paths::default_mac(), printer.clone());
    let a = |i: usize| args.get(i).cloned().unwrap_or_default();
    match a(0).as_str() {
        "env" => out(Ok(env::check_environment(&engine))),
        "models" => out(Ok(models::get_models(&engine))),
        "download" => {
            let ids: Vec<String> = if args.len() > 1 { args[1..].to_vec() } else { models::MODELS.iter().map(|m| m.id.to_string()).collect() };
            if let Err(e) = models::download_models(&engine, &ids) {
                return out::<()>(Err(e));
            }
            while models::is_downloading(&engine) {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            let failed = *printer.failed.lock().unwrap();
            if failed { ExitCode::FAILURE } else { ExitCode::SUCCESS }
        }
        "inspect" => out(files::inspect_file(&engine, Path::new(&a(1)))),
        "run" => {
            let started = match engine.start_job(Path::new(&a(1))) {
                Ok(s) => s,
                Err(e) => return out::<()>(Err(e)),
            };
            line("job-started", &started);
            if a(2) == "--cancel-after" {
                let sec: f64 = a(3).parse().unwrap_or(10.0);
                let (eng, id) = (Arc::clone(&engine), started.job_id.clone());
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs_f64(sec));
                    eng.cancel_job(&id);
                });
            }
            engine.wait();
            if *printer.failed.lock().unwrap() { ExitCode::FAILURE } else { ExitCode::SUCCESS }
        }
        "speakers" => out(results::get_speakers(&engine, &a(1))),
        "hints" => out(results::get_unresolved_hints(&engine, &a(1))),
        "transcript" => out(results::get_transcript(&engine, &a(1), a(2) == "--named")),
        "names" => {
            let names = kikiwake_core::merge::load_json(Path::new(&a(2))).unwrap_or_default();
            out(results::apply_names(&engine, &a(1), &names))
        }
        "save" => {
            let formats = if a(3).is_empty() || a(3).starts_with("--") { "md".to_string() } else { a(3) };
            let formats = formats.split(',').filter_map(|f| serde_json::from_value(json!(f)).ok()).collect();
            let edits = args.iter().position(|x| x == "--edits").and_then(|i| args.get(i + 1))
                .and_then(|p| kikiwake_core::merge::load_json(Path::new(p)).ok());
            let req = SaveRequest { dir: a(2), formats, edits, overwrite: Some(args.iter().any(|x| x == "--overwrite")) };
            out(results::save_outputs(&engine, &a(1), &req))
        }
        "clip" => out(results::recording_clip(&engine, &a(1), a(2).parse().unwrap_or(0.0), a(3).parse().unwrap_or(0.0))),
        "notices" => {
            let segs = kikiwake_core::whisper::parse_ojf(&std::fs::read_to_string(a(1)).unwrap_or_default()).unwrap_or_default();
            let turns: Vec<kikiwake_core::merge::Turn> = kikiwake_core::merge::load_json(Path::new(&a(2))).unwrap_or_default();
            let found = kikiwake_core::repeat::find_repeats(&segs);
            let notices = kikiwake_engine::job::repeat_notices(&found, &turns, a(3).parse().unwrap_or(0.0));
            let times: Vec<_> = notices.iter().map(|n| json!({"startSec": n.start_sec, "endSec": n.end_sec, "speechSec": n.speech_sec})).collect();
            out::<serde_json::Value>(Ok(json!({"found": found.len(), "notices": times})))
        }
        _ => {
            eprintln!("使い方は src-tauri/engine/src/bin/kikiwake-headless.rs の先頭を見てください");
            ExitCode::FAILURE
        }
    }
}
