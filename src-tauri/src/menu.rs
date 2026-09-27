//! Mac のメニュー。Tauri の既定のメニューと同じ並びで、文言を画面の言語（日本語・英語）にする。
//! 画面が言語を切り替えたら作り直す（約束 版7 の setLocale。lib.rs）。
//! 「Kikiwake について」に著作権とライセンスの要約を出し、ヘルプに「ライセンス（全文）」と「Kikiwake のページ」を足す。
//! どちらも利用者が選んだときだけ開く（アプリからは何も送らない）。
use kikiwake_core::lang::Lang;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Manager, Runtime};

/// 公開しているページ
pub const HOMEPAGE: &str = "https://github.com/enomoso-pm/kikiwake";
/// 同梱するライセンスの全文（tauri.conf.json の bundle.resources。.app の Contents/Resources）
const NOTICES_FILE: &str = "THIRD_PARTY_NOTICES.txt";
const LICENSES_ID: &str = "licenses";
const HOMEPAGE_ID: &str = "homepage";

/// メニューの文言（{name} はアプリの名前）
struct Texts {
    about: &'static str,
    services: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    close_window: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    view: &'static str,
    fullscreen: &'static str,
    window: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    close: &'static str,
    help: &'static str,
    licenses: &'static str,
    homepage: &'static str,
    /// 「Kikiwake について」の下に出す文（macOS の「クレジット」）
    credits: &'static str,
}

const JA: Texts = Texts {
    about: "{name} について",
    services: "サービス",
    hide: "{name} を隠す",
    hide_others: "ほかを隠す",
    show_all: "すべてを表示",
    quit: "{name} を終了",
    file: "ファイル",
    close_window: "ウインドウを閉じる",
    edit: "編集",
    undo: "取り消す",
    redo: "やり直す",
    cut: "カット",
    copy: "コピー",
    paste: "ペースト",
    select_all: "すべてを選択",
    view: "表示",
    fullscreen: "フルスクリーンにする",
    window: "ウインドウ",
    minimize: "しまう",
    zoom: "拡大／縮小",
    close: "閉じる",
    help: "ヘルプ",
    licenses: "ライセンス（全文）",
    homepage: "Kikiwake のページ（GitHub）",
    credits: "音声も文字も、この Mac の中だけで処理します。\n\n\
使っているもの: whisper.cpp（MIT）、NeMo-Speech.cpp（Apache 2.0）、Tauri（MIT／Apache 2.0）ほか\n\
初回に取得するモデル: Whisper large-v3（MIT）、Nemotron 3 Diarization（OpenMDW 1.1）\n\n\
全文は、ヘルプの「ライセンス（全文）」から。",
};

const EN: Texts = Texts {
    about: "About {name}",
    services: "Services",
    hide: "Hide {name}",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit {name}",
    file: "File",
    close_window: "Close Window",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    view: "View",
    fullscreen: "Enter Full Screen",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    close: "Close",
    help: "Help",
    licenses: "Licenses (Full Text)",
    homepage: "Kikiwake on GitHub",
    credits: "Audio and text are processed only on this Mac.\n\n\
Built with: whisper.cpp (MIT), NeMo-Speech.cpp (Apache 2.0), Tauri (MIT/Apache 2.0), and more\n\
Models downloaded on first launch: Whisper large-v3 (MIT), Nemotron 3 Diarization (OpenMDW 1.1)\n\n\
For the full text, choose Help > Licenses (Full Text).",
};

/// 英語の「Kikiwake について」の著作権（tauri.conf.json の bundle.copyright を英語にしたもの。そちらを変えたらここも）
const COPYRIGHT_EN: &str = "© 2026 enomoso-pm (MIT License)";

pub fn build<R: Runtime>(app: &AppHandle<R>, lang: Lang) -> tauri::Result<Menu<R>> {
    let t = match lang {
        Lang::Ja => &JA,
        Lang::En => &EN,
    };
    let info = app.package_info();
    let name = info.name.clone();
    let named = |s: &str| s.replace("{name}", &name);
    let copyright = match lang {
        Lang::Ja => app.config().bundle.copyright.clone(),
        Lang::En => Some(COPYRIGHT_EN.to_string()),
    };
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(info.version.to_string()),
        copyright,
        credits: Some(t.credits.into()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&named(t.about)), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(t.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&named(t.hide)))?,
            &PredefinedMenuItem::hide_others(app, Some(t.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(t.show_all))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&named(t.quit)))?,
        ],
    )?;
    let file = Submenu::with_items(app, t.file, true, &[&PredefinedMenuItem::close_window(app, Some(t.close_window))?])?;
    let edit = Submenu::with_items(
        app,
        t.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(t.undo))?,
            &PredefinedMenuItem::redo(app, Some(t.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(t.cut))?,
            &PredefinedMenuItem::copy(app, Some(t.copy))?,
            &PredefinedMenuItem::paste(app, Some(t.paste))?,
            &PredefinedMenuItem::select_all(app, Some(t.select_all))?,
        ],
    )?;
    let view = Submenu::with_items(app, t.view, true, &[&PredefinedMenuItem::fullscreen(app, Some(t.fullscreen))?])?;
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        t.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(t.zoom))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(t.close))?,
        ],
    )?;
    let help = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        t.help,
        true,
        &[
            &MenuItem::with_id(app, LICENSES_ID, t.licenses, true, None::<&str>)?,
            &MenuItem::with_id(app, HOMEPAGE_ID, t.homepage, true, None::<&str>)?,
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
