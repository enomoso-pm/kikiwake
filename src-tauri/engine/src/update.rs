//! 新しい版の知らせ（2026-09-27 決定。約束 版10）。アプリは自動では入れ替えない（利用者が手順を読んで入れ替える）。
//!
//! 起動したときに画面が一度だけ尋ね、GitHub の最新のリリース（enomoso-pm/kikiwake。下書きと試用版は入らない）の版の番号を見て、
//! 今の版より新しければ、その版の題・更新内容・公開日を返す。確かめられなかったとき（ネットにつながらない・まだ公開していない・
//! GitHub の回数の制限）は「無い」として扱い、画面には何も出さない（ログに一行だけ書く）。
//! 問い合わせるのはエンジン（画面は通信しない。画面の安全の設定 CSP の connect-src は緩めない）。
//! 送るのは HTTPS の問い合わせだけで、録音や文字は送らない（GitHub には、この Mac の IP アドレスと Kikiwake の版の番号が伝わる）
use std::time::Duration;

use serde::Deserialize;

use crate::log;
use crate::paths::Paths;
use crate::types::UpdateInfo;

/// 公開しているリポジトリ（README・メニューの「Kikiwake のページ」と同じ）
pub const REPO: &str = "enomoso-pm/kikiwake";

/// GitHub の「最新のリリース」の答えのうち、使う所
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// 「v1.2.3」「1.2.3」→ (1, 2, 3)。それ以外の形（「1.2」「1.2.3-beta」など）は None（比べない）
pub fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let v = s.strip_prefix('v').unwrap_or(s);
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let num = |x: &str| -> Option<u64> {
        if x.is_empty() || x.len() > 9 || !x.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        x.parse().ok()
    };
    Some((num(parts[0])?, num(parts[1])?, num(parts[2])?))
}

/// リリースのページ（版の番号から作る。GitHub が返す URL は使わない）
pub fn release_page(version: &str) -> String {
    format!("https://github.com/{REPO}/releases/tag/v{version}")
}

/// 最新のリリースの答え（JSON）が今の版より新しければ、知らせる中身を作る
pub fn newer_release(json: &str, current: &str) -> Option<UpdateInfo> {
    let r: Release = serde_json::from_str(json).ok()?;
    if r.draft || r.prerelease {
        return None;
    }
    let latest = parse_version(&r.tag_name)?;
    if latest <= parse_version(current)? {
        return None;
    }
    let version = format!("{}.{}.{}", latest.0, latest.1, latest.2);
    Some(UpdateInfo {
        title: r.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("Kikiwake {version}")),
        notes: r.body.unwrap_or_default().replace("\r\n", "\n"),
        published_at: r.published_at.map(|d| d.chars().take(10).collect()).unwrap_or_default(),
        url: release_page(&version),
        current: current.to_string(),
        version,
    })
}

/// 新しい版を尋ねる。無い・確かめられないときは None（理由はログに書く）
pub fn check_update(paths: &Paths, current: &str) -> Option<UpdateInfo> {
    // 開発用のビルドだけ: 問い合わせの代わりに、この JSON を読む（操作役の筋書きで帯と窓を確かめる。ネットにつながない）
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("KIKIWAKE_UPDATE_JSON") {
        return std::fs::read_to_string(p).ok().and_then(|json| newer_release(&json, current));
    }
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(20)).build();
    let res = agent
        .get(&format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", &format!("Kikiwake/{current}"))
        .call();
    let (info, note) = match res {
        Ok(r) => match r.into_string() {
            Ok(text) => {
                let info = newer_release(&text, current);
                let note = match &info {
                    Some(i) => format!("{} がある", i.version),
                    None => "新しい版は無い".to_string(),
                };
                (info, note)
            }
            Err(e) => (None, format!("確かめられない（答えを読めない: {}）", e.kind())),
        },
        Err(ureq::Error::Status(code, _)) => (None, format!("確かめられない（HTTP {code}）")),
        Err(e) => (None, format!("確かめられない（{}）", e.kind())),
    };
    log::write(paths, &format!("新しい版の確認（今は {current}）: {note}"));
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_compared_as_three_numbers() {
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.0.10"), Some((1, 0, 10)));
        for bad in ["1.2", "1.2.3.4", "v1.2.3-beta", "", "v", "1..3", "１.0.0", "1.0.0 "] {
            assert_eq!(parse_version(bad), None, "{bad}");
        }
        // 数として比べる（1.0.10 は 1.0.9 より新しい）
        assert!(parse_version("1.0.10") > parse_version("1.0.9"));
    }

    #[test]
    fn tells_only_a_newer_published_release() {
        let json = |tag: &str, extra: &str| format!(r#"{{"tag_name":"{tag}","name":"Kikiwake {tag}","body":"- 直した所\r\n- 足した所","published_at":"2026-10-05T01:02:03Z","html_url":"https://example.com/phish"{extra}}}"#);
        let i = newer_release(&json("v1.0.1", ""), "1.0.0").unwrap();
        assert_eq!((i.version.as_str(), i.current.as_str(), i.published_at.as_str()), ("1.0.1", "1.0.0", "2026-10-05"));
        assert_eq!(i.notes, "- 直した所\n- 足した所");
        // 開くページは版の番号から作る（答えの html_url は使わない）
        assert_eq!(i.url, "https://github.com/enomoso-pm/kikiwake/releases/tag/v1.0.1");
        // 同じ版・古い版・試用版・下書き・形の違う番号・読めない答えは知らせない
        assert!(newer_release(&json("v1.0.0", ""), "1.0.0").is_none());
        assert!(newer_release(&json("v0.9.9", ""), "1.0.0").is_none());
        assert!(newer_release(&json("v1.1.0", r#","prerelease":true"#), "1.0.0").is_none());
        assert!(newer_release(&json("v1.1.0", r#","draft":true"#), "1.0.0").is_none());
        assert!(newer_release(&json("v1.1", ""), "1.0.0").is_none());
        assert!(newer_release("{", "1.0.0").is_none());
        // 題が無ければ「Kikiwake 〈版〉」
        let bare = r#"{"tag_name":"v2.0.0"}"#;
        assert_eq!(newer_release(bare, "1.0.0").unwrap().title, "Kikiwake 2.0.0");
    }
}
