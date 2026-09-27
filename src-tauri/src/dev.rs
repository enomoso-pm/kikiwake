//! 開発用のビルドだけに入る「操作役」（Phase 2 手順5。製品のビルドには入らない）。
//! 環境変数 KIKIWAKE_DEV_E2E に筋書き（JSON）のパスを入れて起動すると、画面（ui/ の製品と同じビルド）に
//! src-tauri/dev/init.js（安全の設定 CSP の違反・エラー・音の再生を記録）と dev/e2e.js（ボタンを押し、入力し、画面の文と件数を読む）を入れる。
//! ui/ のファイルは触らない。結果は標準出力に1行ずつ（「[画面] OK …」「[画面] NG …」）。終わるとアプリを閉じ、NG があれば終了コード 1。
//! 動かし方は scripts/e2e_mac.sh。
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, State};

use crate::AppState;

/// 台本の置き場所（開発用のビルドだけなので、作ったときの場所を焼き込む）
const DEV_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/dev");

fn scenario_path() -> Option<PathBuf> {
    std::env::var_os("KIKIWAKE_DEV_E2E").filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// 筋書きがあるときだけ、画面の読み込みの初めに台本を入れる（台本は起動のたびに読む。Rust を作り直さずに直せる）
pub fn plugin<R: Runtime>() -> Option<tauri::plugin::TauriPlugin<R>> {
    scenario_path()?;
    let read = |name: &str| {
        std::fs::read_to_string(format!("{DEV_DIR}/{name}")).unwrap_or_else(|e| panic!("{DEV_DIR}/{name} を読めない: {e}"))
    };
    let js = [read("snapshot.js"), read("init.js"), read("e2e.js")].join("\n");
    Some(tauri::plugin::Builder::new("kikiwake-dev").js_init_script(js).build())
}

/// 筋書き（scripts/e2e_mac.sh が作る JSON）
#[tauri::command]
pub fn dev_scenario() -> Result<serde_json::Value, String> {
    let p = scenario_path().ok_or("KIKIWAKE_DEV_E2E が無い")?;
    let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))
}

/// 操作役の結果を標準出力に出す
#[tauri::command]
pub fn dev_log(text: String) {
    println!("[画面] {text}");
}

/// Finder からのドロップのまね。Tauri が出すのと同じ知らせ（tauri://drag-drop。中身は paths と position）を窓に送る
#[tauri::command]
pub fn dev_drop(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let payload = serde_json::json!({ "paths": paths, "position": { "x": 0, "y": 0 } });
    app.emit_to(EventTarget::labeled("main"), "tauri://drag-drop", payload).map_err(|e| e.to_string())
}

/// Finder からのドラッグのまね（窓の上を動く・出る）。外枠がドラッグで出すのと同じ知らせ（file-drag）を、同じ関数で送る。
/// x・y は画面の CSS の座標（macOS の wry がドラッグで渡すのと同じ単位）
#[tauri::command]
pub fn dev_drag(app: AppHandle, over: bool, x: f64, y: f64) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("窓が無い")?;
    let scale = win.scale_factor().unwrap_or(1.0);
    crate::emit_file_drag(&win, scale, over, over.then(|| tauri::PhysicalPosition::new(x, y)));
    Ok(())
}

/// 窓を閉じる操作のまね（赤いボタンと同じく、閉じる前の知らせ CloseRequested から始まる）
#[tauri::command]
pub fn dev_close(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main").ok_or("窓が無い")?.close().map_err(|e| e.to_string())
}

/// 保存したファイルを読む（見本と比べる）
#[tauri::command]
pub fn dev_read(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// ファイルやフォルダがあるか（履歴から消しても、元の録音と保存したファイルが残るかを見る）
#[tauri::command]
pub fn dev_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// 名前を変える（元の録音が見つからない場合を作る・元に戻す）
#[tauri::command]
pub fn dev_rename(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| format!("{from} → {to}: {e}"))
}

/// 見た目の比べ用の記録を書く
#[tauri::command]
pub fn dev_write(path: String, text: String) -> Result<(), String> {
    std::fs::write(&path, text).map_err(|e| format!("{path}: {e}"))
}

/// 画面の中身を PNG に撮る（WebKit の takeSnapshot。窓の枠は入らない。OS の画面収録の許可は要らない）
#[tauri::command]
pub async fn dev_screenshot(app: AppHandle, path: String) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("窓が無い")?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    win.with_webview(move |pv| {
        #[cfg(target_os = "macos")]
        snapshot(pv.inner(), path, tx);
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (pv, path);
            let _ = tx.send(Err("画面の画像は Mac だけ".into()));
        }
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|_| "撮れない（時間切れ）".to_string())?
}

/// 窓の中身（WKWebView）を撮って PNG で書く。画面の糸（メインスレッド）で呼ぶ。終わりは tx で知らせる
#[cfg(target_os = "macos")]
fn snapshot(webview: *mut std::ffi::c_void, path: String, tx: std::sync::mpsc::Sender<Result<(), String>>) {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    let done = block2::RcBlock::new(move |image: *mut NSImage, err: *mut NSError| {
        // SAFETY: WebKit が渡す画像とエラー（どちらか一方が null）。この呼び出しの間だけ使う
        let r = (|| unsafe {
            let image = image.as_ref().ok_or_else(|| {
                err.as_ref().map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "撮れない".into())
            })?;
            let tiff = image.TIFFRepresentation().ok_or("TIFF にできない")?;
            let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("画像にできない")?;
            let png = rep
                .representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
                .ok_or("PNG にできない")?;
            std::fs::write(&path, png.to_vec()).map_err(|e| format!("{path}: {e}"))
        })();
        let _ = tx.send(r);
    });
    // SAFETY: Tauri が渡す、この窓の WKWebView（with_webview の中なので画面の糸で、生きている）
    unsafe {
        let wk = &*(webview as *const WKWebView);
        wk.takeSnapshotWithConfiguration_completionHandler(None, &done);
    }
}

/// Mac のメニューの文言（約束 版7 の確かめ）: 上に並ぶメニューの名前 → 中の項目の文言（区切りは除く）
#[tauri::command]
pub fn dev_menu(app: AppHandle) -> Result<serde_json::Value, String> {
    use tauri::menu::MenuItemKind;
    let text = |k: &MenuItemKind<tauri::Wry>| match k {
        MenuItemKind::MenuItem(i) => i.text(),
        MenuItemKind::Submenu(i) => i.text(),
        MenuItemKind::Predefined(i) => i.text(),
        MenuItemKind::Check(i) => i.text(),
        MenuItemKind::Icon(i) => i.text(),
    };
    let menu = app.menu().ok_or("メニューが無い")?;
    let mut out = Vec::new();
    for k in menu.items().map_err(|e| e.to_string())? {
        if let MenuItemKind::Submenu(sub) = &k {
            let mut items = Vec::new();
            for i in sub.items().map_err(|e| e.to_string())? {
                let t = text(&i).map_err(|e| e.to_string())?;
                if !t.is_empty() {
                    items.push(t);
                }
            }
            out.push(serde_json::json!({ "title": sub.text().map_err(|e| e.to_string())?, "items": items }));
        }
    }
    Ok(serde_json::Value::Array(out))
}

/// Mac が実際に出しているメニュー（NSApp.mainMenu）の文言。Tauri のメニューのほかに macOS が足す項目も入る。
/// 「Mac が用意する部品」の言語（Info.plist の対応言語の宣言で変わる）を確かめるため
#[tauri::command]
pub fn dev_native_menu(app: AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSApplication;
            let mut out = Vec::new();
            if let Some(mtm) = MainThreadMarker::new() {
                if let Some(menu) = NSApplication::sharedApplication(mtm).mainMenu() {
                    for top in menu.itemArray().iter() {
                        let Some(sub) = top.submenu() else { continue };
                        let items: Vec<String> =
                            sub.itemArray().iter().map(|i| i.title().to_string()).filter(|t| !t.is_empty()).collect();
                        out.push(format!("{}: {}", top.title(), items.join("・")));
                    }
                }
            }
            let _ = tx.send(out);
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "読めない（時間切れ）".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Mac だけ".into())
    }
}

/// 窓の中身の大きさを変える（画面の CSS の座標。英語のはみ出しを 1200×800 と最小の 900×560 で測る）
#[tauri::command]
pub fn dev_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("窓が無い")?;
    win.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

/// 終わり。確かめずにアプリを閉じる（NG があれば終了コード 1）
#[tauri::command]
pub fn dev_done(app: AppHandle, state: State<'_, AppState>, ok: bool, summary: String) {
    println!("[画面] おわり {summary}");
    state.closing.store(true, Ordering::SeqCst);
    app.exit(if ok { 0 } else { 1 });
}
