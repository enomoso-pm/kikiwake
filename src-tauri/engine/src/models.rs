//! モデルの取得（初回セットアップ）。保存先は ~/Library/Application Support/Kikiwake/models。
//! 中断しても続きから再開する（<名前>.part に途中まで書き、HTTP の Range で続きを取る）。
//! 取り終えたら SHA-256 を照合し、合っていたときだけ本来の名前にする（本来の名前のファイルがあれば照合済み）。
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::engines::{ASR_MODEL_FILE, DIAR_MODEL_FILE};
use crate::error::{io_error, AppError};
use crate::job::{free_bytes, Engine};
use crate::log;
use crate::proc::Cancel;
use crate::types::{ModelInfo, ModelState};

pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// 取得先・大きさ・SHA-256（Hugging Face の LFS 情報、2026-09-25 取得）。
/// 取得先は版（コミット）を固定する。main を指すと、置き主がファイルを更新したときに照合が合わず、全員の取得が失敗する
/// （Nemotron は 2026-09-24 に更新されていた）。固定した版の大きさと SHA-256 が下の値と同じことを 2026-09-26 に確かめた
pub const MODELS: [ModelSpec; 2] = [
    ModelSpec {
        id: "whisper-large-v3",
        label: "書き起こし",
        file: ASR_MODEL_FILE,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3.bin",
        size: 3_095_033_483,
        sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
    },
    ModelSpec {
        id: "nemotron-3-diarization",
        label: "話者の判定",
        file: DIAR_MODEL_FILE,
        url: "https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/f667ed73aee57d40cc39428eb768b4fd87a0a29e/Nemotron-3-Diarization.q8_0.gguf",
        size: 107_012_128,
        sha256: "08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1",
    },
];

fn part_path(dir: &Path, spec: &ModelSpec) -> std::path::PathBuf {
    dir.join(format!("{}.part", spec.file))
}

fn info(dir: &Path, spec: &ModelSpec) -> ModelInfo {
    let done = dir.join(spec.file);
    let part = part_path(dir, spec);
    let (state, got) = if done.metadata().is_ok_and(|m| m.len() == spec.size) {
        (ModelState::Ready, spec.size)
    } else if let Ok(m) = part.metadata() {
        (ModelState::Partial, m.len().min(spec.size))
    } else {
        (ModelState::Missing, 0)
    };
    ModelInfo { id: spec.id.into(), label: spec.label.into(), size_bytes: spec.size, state, downloaded_bytes: got, error: None }
}

pub fn get_models(engine: &Engine) -> Vec<ModelInfo> {
    MODELS.iter().map(|s| info(&engine.paths.models, s)).collect()
}

/// 取得を始める（別のスレッドで。進み具合は model_progress で届く）。すでに取得中なら何もしない
pub fn download_models(engine: &Arc<Engine>, ids: &[String]) -> Result<(), AppError> {
    let mut slot = engine.download.lock().unwrap();
    if slot.as_ref().is_some_and(|c| !c.is_cancelled()) {
        return Ok(());
    }
    let dir = engine.paths.models.clone();
    fs::create_dir_all(&dir).map_err(|e| io_error(&e, "モデルの保存先"))?;
    // 画面が渡した順に1つずつ取る（UI 画面仕様書 §4.4: 話者の判定モデル → 書き起こしモデルの順）
    let want: Vec<&'static ModelSpec> = ids
        .iter()
        .filter_map(|i| MODELS.iter().find(|s| s.id == i))
        .filter(|s| info(&dir, s).state != ModelState::Ready)
        .collect();
    let remaining: u64 = want.iter().map(|s| s.size - info(&dir, s).downloaded_bytes).sum();
    if let Some(free) = free_bytes(&dir) {
        let need = remaining + 500_000_000;
        if free < need {
            return Err(AppError::disk_full(need - free));
        }
    }
    let cancel = Arc::new(Cancel::new());
    *slot = Some(Arc::clone(&cancel));
    drop(slot);
    let me = Arc::clone(engine);
    std::thread::spawn(move || {
        for spec in want {
            let mut last = Instant::now() - Duration::from_secs(1);
            let r = download_one(&dir, spec, &cancel, |state, got| {
                if state != ModelState::Downloading || last.elapsed() >= Duration::from_millis(500) || got == spec.size {
                    last = Instant::now();
                    me.events.model_progress(&ModelInfo {
                        id: spec.id.into(), label: spec.label.into(), size_bytes: spec.size, state, downloaded_bytes: got, error: None,
                    });
                }
            });
            match r {
                Ok(()) => me.events.model_progress(&info(&dir, spec)),
                Err(e) => {
                    log::write(&me.paths, &format!("モデルの取得 {} 失敗 {e}", spec.id));
                    let mut m = info(&dir, spec);
                    if !e.is_cancelled() {
                        m.state = ModelState::Error;
                        m.error = Some(e);
                    }
                    me.events.model_progress(&m);
                    break;
                }
            }
        }
        *me.download.lock().unwrap() = None;
    });
    Ok(())
}

pub fn cancel_download(engine: &Engine) {
    if let Some(c) = engine.download.lock().unwrap().as_ref() {
        c.cancel();
    }
}

/// 取得中か（画面なしのコマンドが終わりを待つのに使う）
pub fn is_downloading(engine: &Engine) -> bool {
    engine.download.lock().unwrap().is_some()
}

fn http_error(e: ureq::Error) -> AppError {
    match e {
        ureq::Error::Status(code, _) => AppError::download_failed().with_detail(format!("HTTP {code}")),
        ureq::Error::Transport(t) => match t.kind() {
            ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed | ureq::ErrorKind::ProxyConnect => {
                AppError::network_unreachable().with_detail(t.to_string())
            }
            _ => AppError::download_failed().with_detail(t.to_string()),
        },
    }
}

/// 1つ取得する。on_state には（状態, 取得済みのバイト数）
pub fn download_one(dir: &Path, spec: &ModelSpec, cancel: &Cancel, mut on_state: impl FnMut(ModelState, u64)) -> Result<(), AppError> {
    let part = part_path(dir, spec);
    let mut have = part.metadata().map(|m| m.len()).unwrap_or(0);
    if have > spec.size {
        let _ = fs::remove_file(&part);
        have = 0;
    }
    if have < spec.size {
        on_state(ModelState::Downloading, have);
        let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(60)).build();
        let mut req = agent.get(spec.url);
        if have > 0 {
            req = req.set("Range", &format!("bytes={have}-"));
        }
        let resp = req.call().map_err(http_error)?;
        if have > 0 && resp.status() != 206 {
            have = 0; // 続きからの取得に応じなかった（最初から取り直す）
        }
        let mut f = OpenOptions::new().create(true).write(true).append(have > 0).truncate(have == 0).open(&part)
            .map_err(|e| io_error(&e, "モデルの保存先"))?;
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; 1 << 20];
        while have < spec.size {
            if cancel.is_cancelled() {
                return Err(AppError::cancelled(false));
            }
            let n = reader.read(&mut buf).map_err(|e| AppError::download_failed().with_detail(e.to_string()))?;
            if n == 0 {
                return Err(AppError::download_failed().with_detail(format!("{have} バイトで途切れた")));
            }
            f.write_all(&buf[..n]).map_err(|e| io_error(&e, "モデルの保存先"))?;
            have += n as u64;
            on_state(ModelState::Downloading, have.min(spec.size));
        }
        f.flush().map_err(|e| io_error(&e, "モデルの保存先"))?;
    }
    on_state(ModelState::Verifying, spec.size);
    let got = sha256_file(&part, cancel)?;
    if got != spec.sha256 {
        let _ = fs::remove_file(&part);
        return Err(AppError::checksum_mismatch().with_detail(format!("{}: {got}", spec.file)));
    }
    fs::rename(&part, dir.join(spec.file)).map_err(|e| io_error(&e, "モデルの保存先"))?;
    Ok(())
}

pub fn sha256_file(path: &Path, cancel: &Cancel) -> Result<String, AppError> {
    let mut f = fs::File::open(path).map_err(|e| io_error(&e, "モデル"))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 4 << 20];
    loop {
        if cancel.is_cancelled() {
            return Err(AppError::cancelled(false));
        }
        let n = f.read(&mut buf).map_err(|e| io_error(&e, "モデル"))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
