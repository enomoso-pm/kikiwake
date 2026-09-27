//! 保存するファイルの言語（受け渡しの約束 版7。画面の言語に合わせる。2026-09-27）。
//!
//! 日本語は移植元の Python 版と一字一句同じ書式のまま（`merge::render_markdown`・`lines::render_txt`）。
//! 英語は見出し・確認用の欄・「話者A」「不明」を英語にしたもの（並びと時刻の書き方は日本語と同じ）。
//! 作業フォルダの中のファイル（transcript.json・names.json など）とラベルの持ち方は日本語のまま変えず、書き出すときだけ訳す。

use std::borrow::Cow;

use serde::{Deserialize, Serialize};

use crate::merge::UNKNOWN;

/// 画面の言語（約束の `Locale`）
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    Ja,
    En,
}

impl Lang {
    /// 「ja」「en」から。知らない値は None
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "ja" => Some(Self::Ja),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ja => "ja",
            Self::En => "en",
        }
    }

    /// Mac の言語の並びの先頭から決める。画面と同じ決め方（日本語なら日本語、それ以外は英語）
    pub fn from_preferred(first: &str) -> Self {
        if first.to_ascii_lowercase().starts_with("ja") { Self::Ja } else { Self::En }
    }
}

/// 話者のラベルを英語に: 「話者A」→「Speaker A」、「話者27」→「Speaker 27」、「不明」→「Unknown」。利用者が付けた名前はそのまま
pub fn speaker_en(s: &str) -> Cow<'_, str> {
    if s == UNKNOWN {
        return Cow::Borrowed("Unknown");
    }
    match s.strip_prefix("話者") {
        Some(rest)
            if !rest.is_empty()
                && (rest.chars().all(|c| c.is_ascii_uppercase()) || rest.chars().all(|c| c.is_ascii_digit())) =>
        {
            Cow::Owned(format!("Speaker {rest}"))
        }
        _ => Cow::Borrowed(s),
    }
}

/// 話者の名前・ラベルを、その言語で書く
pub fn speaker(lang: Lang, s: &str) -> Cow<'_, str> {
    match lang {
        Lang::Ja => Cow::Borrowed(s),
        Lang::En => speaker_en(s),
    }
}

/// エンジンの名前（meta.json の diarizer・asr）を英語の文に入れる形に: 全角の括弧を半角に
/// （「Whisper large-v3（whisper.cpp）」→「Whisper large-v3 (whisper.cpp)」）
pub fn engine_name_en(s: &str) -> String {
    s.replace('（', " (").replace('）', ")")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speaker_labels_in_english() {
        assert_eq!(speaker_en("話者A"), "Speaker A");
        assert_eq!(speaker_en("話者27"), "Speaker 27");
        assert_eq!(speaker_en("不明"), "Unknown");
        // 利用者が付けた名前・ラベルの形でないものは訳さない
        for s in ["田中", "話者", "話者a", "話者A1", "Speaker A", "話者Ｂ"] {
            assert_eq!(speaker_en(s), s);
        }
        assert_eq!(speaker(Lang::Ja, "話者A"), "話者A");
    }

    #[test]
    fn lang_from_mac_languages() {
        assert_eq!(Lang::from_preferred("ja-JP"), Lang::Ja);
        assert_eq!(Lang::from_preferred("ja"), Lang::Ja);
        assert_eq!(Lang::from_preferred("en-US"), Lang::En);
        assert_eq!(Lang::from_preferred("fr-FR"), Lang::En);
        assert_eq!(Lang::from_preferred(""), Lang::En);
        assert_eq!(Lang::parse("en"), Some(Lang::En));
        assert_eq!(Lang::parse("zh"), None);
        assert_eq!(engine_name_en("Whisper large-v3（whisper.cpp）"), "Whisper large-v3 (whisper.cpp)");
    }
}
