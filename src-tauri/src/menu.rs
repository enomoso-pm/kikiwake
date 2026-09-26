//! Mac のメニュー。Tauri の既定のメニューと同じ並びで、文言を日本語にする（画面が日本語だけのため）。
//! 「Kikiwake について」に著作権とライセンスの要約を出し、ヘルプに「ライセンス（全文）」と「Kikiwake のページ」を足す。
//! どちらも利用者が選んだときだけ開く（アプリからは何も送らない）。
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Manager, Runtime};

/// 公開しているページ
pub const HOMEPAGE: &str = "https://github.com/enomoso-pm/kikiwake";
/// 同梱するライセンスの全文（tauri.conf.json の bundle.resources。.app の Contents/Resources）
const NOTICES_FILE: &str = "THIRD_PARTY_NOTICES.txt";
const LICENSES_ID: &str = "licenses";
const HOMEPAGE_ID: &str = "homepage";

/// 「Kikiwake について」の下に出す文（macOS の「クレジット」）
const CREDITS: &str = "音声も文字も、この Mac の中だけで処理します。\n\n\
使っているもの: whisper.cpp（MIT）、NeMo-Speech.cpp（Apache 2.0）、Tauri（MIT／Apache 2.0）ほか\n\
初回に取得するモデル: Whisper large-v3（MIT）、Nemotron 3 Diarization（OpenMDW 1.1）\n\n\
全文は、ヘルプの「ライセンス（全文）」から。";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let name = info.name.clone();
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(info.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        credits: Some(CREDITS.into()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&format!("{name} について")), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("サービス"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&format!("{name} を隠す")))?,
            &PredefinedMenuItem::hide_others(app, Some("ほかを隠す"))?,
            &PredefinedMenuItem::show_all(app, Some("すべてを表示"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&format!("{name} を終了")))?,
        ],
    )?;
    let file = Submenu::with_items(app, "ファイル", true, &[&PredefinedMenuItem::close_window(app, Some("ウインドウを閉じる"))?])?;
    let edit = Submenu::with_items(
        app,
        "編集",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("取り消す"))?,
            &PredefinedMenuItem::redo(app, Some("やり直す"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("カット"))?,
            &PredefinedMenuItem::copy(app, Some("コピー"))?,
            &PredefinedMenuItem::paste(app, Some("ペースト"))?,
            &PredefinedMenuItem::select_all(app, Some("すべてを選択"))?,
        ],
    )?;
    let view = Submenu::with_items(app, "表示", true, &[&PredefinedMenuItem::fullscreen(app, Some("フルスクリーンにする"))?])?;
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "ウインドウ",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("しまう"))?,
            &PredefinedMenuItem::maximize(app, Some("拡大／縮小"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("閉じる"))?,
        ],
    )?;
    let help = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "ヘルプ",
        true,
        &[
            &MenuItem::with_id(app, LICENSES_ID, "ライセンス（全文）", true, None::<&str>)?,
            &MenuItem::with_id(app, HOMEPAGE_ID, "Kikiwake のページ（GitHub）", true, None::<&str>)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

/// メニューを選んだとき。全文はテキストエディットで、ページは既定のブラウザで開く
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let args: Vec<String> = match id {
        LICENSES_ID => match app.path().resource_dir() {
            Ok(dir) => vec!["-t".into(), dir.join(NOTICES_FILE).display().to_string()],
            Err(_) => return,
        },
        HOMEPAGE_ID => vec![HOMEPAGE.into()],
        _ => return,
    };
    std::thread::spawn(move || {
        let _ = std::process::Command::new("/usr/bin/open").args(&args).status();
    });
}
