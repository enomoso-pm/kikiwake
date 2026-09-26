//! Kikiwake の外枠（Tauri）。画面（ui/）が呼ぶ関数（contract/api.ts の KikiwakeApi）を、処理の流れ（engine）につなぐ。
//! 画面側の実装は ui/src/api/tauri.ts（invoke とイベント）。関数名は約束の名前をそのまま snake_case にしたもの。
//! イベント: model-progress・job-progress・job-done・job-failed（中身は約束の ModelInfo・JobProgress・JobDone・JobFailed）、
//! close-requested（約束 版5・版6。処理中か、保存していない手直しがあるときに窓を閉じようとした）、
//! file-drag（約束 版6。ファイルのドラッグが窓の上にある間の位置。中身は約束の FileDragOver）
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use kikiwake_core::lines::SaveResult;
use kikiwake_core::merge::Names;
use kikiwake_core::unresolved::UnresolvedHint;
use kikiwake_core::view::SpeakerCard;
use kikiwake_engine::types::{
    EnvironmentCheck, Events, FileInfo, JobDone, JobFailed, JobProgress, JobStarted, ModelInfo, SaveRequest, TranscriptOut,
};
use kikiwake_engine::{env, files, models, results, AppError, Engine, Paths};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, PhysicalPosition, RunEvent, Runtime, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

struct TauriEvents(AppHandle);

impl Events for TauriEvents {
    fn job_progress(&self, p: &JobProgress) {
        let _ = self.0.emit("job-progress", p);
    }
    fn job_done(&self, d: &JobDone) {
        let _ = self.0.emit("job-done", d);
    }
    fn job_failed(&self, f: &JobFailed) {
        let _ = self.0.emit("job-failed", f);
    }
    fn model_progress(&self, m: &ModelInfo) {
        let _ = self.0.emit("model-progress", m);
    }
}

struct AppState {
    engine: Arc<Engine>,
    /// closeApp が呼ばれた（このあとの閉じる・終わるは止めない）
    closing: AtomicBool,
    /// 画面が「保存していない手直しがある」と知らせている（約束 版6 の setUnsavedChanges）
    unsaved: AtomicBool,
}

impl AppState {
    /// 閉じるのを止めて、画面に確かめてもらうか（処理中か保存していない手直しがあり、まだ closeApp が呼ばれていない）。
    /// 画面が応えられなくなっても閉じられるよう、止めるのはこの2つのときだけ（2026-09-26 決定）
    fn should_confirm_close(&self) -> bool {
        (self.engine.is_busy() || self.unsaved.load(Ordering::SeqCst)) && !self.closing.load(Ordering::SeqCst)
    }
}

/// ドラッグの知らせ（約束 版6 の FileDragOver）
#[derive(Clone, serde::Serialize)]
struct FileDrag {
    over: bool,
    x: f64,
    y: f64,
}

/// ファイルのドラッグの位置を画面の CSS の座標にして知らせる。
/// macOS の wry（0.55.1）は窓の中の座標（ポイント。倍率を掛ける前）を、そのまま PhysicalPosition に入れてくる
/// （tauri-runtime-wry 2.11.4 で確かめた）ので、そのまま使う。ほかの OS は物理ピクセルとみなして倍率で割る（Phase 3 で確かめる）
fn emit_file_drag<R: Runtime>(to: &impl Emitter<R>, scale: f64, over: bool, pos: Option<PhysicalPosition<f64>>) {
    let (x, y) = match pos {
        Some(p) if cfg!(target_os = "macos") => (p.x, p.y),
        Some(p) => (p.x / scale, p.y / scale),
        None => (0.0, 0.0),
    };
    let _ = to.emit("file-drag", FileDrag { over, x, y });
}

type R<T> = Result<T, AppError>;

// ---- 画面1 初回セットアップ ----

#[tauri::command]
async fn check_environment(state: State<'_, AppState>) -> R<EnvironmentCheck> {
    Ok(env::check_environment(&state.engine))
}

#[tauri::command]
async fn get_models(state: State<'_, AppState>) -> R<Vec<ModelInfo>> {
    Ok(models::get_models(&state.engine))
}

#[tauri::command]
async fn download_models(state: State<'_, AppState>, ids: Vec<String>) -> R<()> {
    models::download_models(&state.engine, &ids)
}

#[tauri::command]
async fn cancel_download(state: State<'_, AppState>) -> R<()> {
    models::cancel_download(&state.engine);
    Ok(())
}

// ---- 画面2 ファイル選択 ----

#[tauri::command]
async fn pick_media_file(app: AppHandle) -> R<Option<String>> {
    let picked = app.dialog().file().add_filter("録音・録画", &files::SUPPORTED).blocking_pick_file();
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[tauri::command]
async fn inspect_file(state: State<'_, AppState>, path: String) -> R<FileInfo> {
    files::inspect_file(&state.engine, Path::new(&path))
}

// ---- 画面3 処理中 ----

#[tauri::command]
async fn start_job(state: State<'_, AppState>, path: String) -> R<JobStarted> {
    state.engine.start_job(Path::new(&path))
}

#[tauri::command]
async fn cancel_job(state: State<'_, AppState>, job_id: String) -> R<()> {
    state.engine.cancel_job(&job_id);
    Ok(())
}

// ---- 画面4 名前付け ----

#[tauri::command]
async fn get_speakers(state: State<'_, AppState>, job_id: String) -> R<Vec<SpeakerCard>> {
    results::get_speakers(&state.engine, &job_id)
}

#[tauri::command]
async fn get_unresolved_hints(state: State<'_, AppState>, job_id: String) -> R<Vec<UnresolvedHint>> {
    results::get_unresolved_hints(&state.engine, &job_id)
}

#[tauri::command]
async fn apply_names(state: State<'_, AppState>, job_id: String, names: Names) -> R<TranscriptOut> {
    results::apply_names(&state.engine, &job_id, &names)
}

// ---- 画面5 結果 ----

#[tauri::command]
async fn get_transcript(state: State<'_, AppState>, job_id: String, named: bool) -> R<TranscriptOut> {
    results::get_transcript(&state.engine, &job_id, named)
}

#[tauri::command]
async fn pick_folder(app: AppHandle, default_dir: Option<String>) -> R<Option<String>> {
    let mut d = app.dialog().file();
    if let Some(dir) = default_dir.map(PathBuf::from) {
        // 既定の保存先（まだ無いフォルダ）なら、その親を開く
        let open = if dir.is_dir() { Some(dir) } else { dir.parent().map(Path::to_path_buf) };
        if let Some(o) = open {
            d = d.set_directory(o);
        }
    }
    Ok(d.blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[tauri::command]
async fn save_outputs(state: State<'_, AppState>, job_id: String, req: SaveRequest) -> R<SaveResult> {
    results::save_outputs(&state.engine, &job_id, &req)
}

/// 行の再生に使う WAV のパス（画面側で convertFileSrc して <audio src> に入れる）
#[tauri::command]
async fn recording_clip(state: State<'_, AppState>, job_id: String, start_sec: f64, end_sec: f64) -> R<String> {
    results::recording_clip(&state.engine, &job_id, start_sec, end_sec).map(|p| p.display().to_string())
}

#[tauri::command]
async fn reveal_in_file_manager(path: String) -> R<()> {
    results::reveal_in_file_manager(Path::new(&path))
}

// ---- 全体（約束 版5） ----

/// 保存していない手直しがあるか（約束 版6）。true のあいだは、閉じる前に画面に確かめてもらう
#[tauri::command]
async fn set_unsaved_changes(state: State<'_, AppState>, unsaved: bool) -> R<()> {
    state.unsaved.store(unsaved, Ordering::SeqCst);
    Ok(())
}

/// 処理を止めてアプリを閉じる（画面の「閉じる確認」で「閉じる」を選んだとき）
#[tauri::command]
async fn close_app(app: AppHandle, state: State<'_, AppState>) -> R<()> {
    state.closing.store(true, Ordering::SeqCst);
    state.engine.shutdown();
    app.exit(0);
    Ok(())
}

/// 開発用のビルドだけの操作役（画面を自動で動かして確かめる。製品のビルドには入らない）
#[cfg(debug_assertions)]
mod dev;
/// Mac のメニュー（日本語・「Kikiwake について」とライセンス）
mod menu;

/// 画面が呼べる関数の一覧（開発用のビルドでは dev の関数を足す）
macro_rules! handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![
            check_environment,
            get_models,
            download_models,
            cancel_download,
            pick_media_file,
            inspect_file,
            start_job,
            cancel_job,
            get_speakers,
            get_unresolved_hints,
            apply_names,
            get_transcript,
            pick_folder,
            save_outputs,
            recording_clip,
            reveal_in_file_manager,
            set_unsaved_changes,
            close_app
            $(, $extra)*
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = {
        let b = builder.invoke_handler(handlers!(
            dev::dev_scenario,
            dev::dev_log,
            dev::dev_drop,
            dev::dev_drag,
            dev::dev_close,
            dev::dev_read,
            dev::dev_write,
            dev::dev_screenshot,
            dev::dev_done
        ));
        match dev::plugin() {
            Some(p) => b.plugin(p),
            None => b,
        }
    };
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(handlers!());
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build)
        .on_menu_event(|app, e| menu::on_event(app, e.id().as_ref()))
        .setup(|app| {
            let paths = Paths::default_mac();
            // サンプル音声・行の再生の WAV（作業フォルダの中）だけを画面で再生できるようにする
            std::fs::create_dir_all(paths.jobs())?;
            app.asset_protocol_scope().allow_directory(paths.jobs(), true)?;
            let engine = Engine::new(paths, Arc::new(TauriEvents(app.handle().clone())));
            // 前に消し損ねた作業ファイルと、30 日選び直していない録音を消す（画面が処理を始める前に。engine の tidy.rs）
            engine.tidy_on_start();
            app.manage(AppState { engine, closing: AtomicBool::new(false), unsaved: AtomicBool::new(false) });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 処理中か、保存していない手直しがあるときに窓を閉じようとしたら、閉じずに画面に知らせる（画面が確かめて closeApp を呼ぶ）
            WindowEvent::CloseRequested { api, .. } => {
                if window.state::<AppState>().should_confirm_close() {
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
            // ファイルのドラッグ（アプリの中では HTML5 の dragenter・dragover が画面に届かないので、位置を知らせる。約束 版6）
            WindowEvent::DragDrop(e) => {
                let scale = window.scale_factor().unwrap_or(1.0);
                match e {
                    DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => {
                        emit_file_drag(window, scale, true, Some(*position))
                    }
                    DragDropEvent::Drop { position, .. } => emit_file_drag(window, scale, false, Some(*position)),
                    _ => emit_file_drag(window, scale, false, None),
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("Kikiwake を起動できない");
    app.run(|handle, event| match event {
        // ⌘Q など、処理中か保存していない手直しがあるときにアプリを終わろうとしたときも、画面に確かめてもらう（closeApp からの終わりは止めない）
        RunEvent::ExitRequested { api, code, .. } if code.is_none() && handle.state::<AppState>().should_confirm_close() => {
            api.prevent_exit();
            let _ = handle.emit("close-requested", ());
        }
        // 終わるときは、動いているエンジン（書き起こしなど）とダウンロードを止め、取り出した音声を消す（最大 5 秒待つ。engine の tidy.rs）
        RunEvent::Exit => handle.state::<AppState>().engine.finish(Duration::from_secs(5)),
        _ => {}
    });
}
