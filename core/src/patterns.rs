//! 移植元の正規表現（merge.py・speakers.py・diarize.py）。書き方は Python と同じにし、`\s` だけ
//! `[\s\x1C-\x1F]` に置き換える（Python の `\s` は U+001C〜001F も含むが、Rust の `\s` は含まない）。
//! 一致の仕方（左から探し、繰り返しは長いほうを優先し、一致の後ろから次を探す）は Python の re と同じ。

use std::sync::LazyLock;

use regex::Regex;

/// 名前の候補（漢字・カタカナ 1〜6 文字）。speakers.py の NAME
const NAME: &str = r"([一-龥々〆ヵヶァ-ヴー]{1,6})";

fn re(p: &str) -> Regex {
    Regex::new(p).expect("正規表現")
}

/// Whisper が無音や区間の切れ目で作り出す定番の文（merge.py の HALLUCINATION）
pub static HALLUCINATION: LazyLock<Regex> =
    LazyLock::new(|| re(r"ご視聴ありがとうございました|チャンネル登録|字幕(?:は|by|提供)|最後までご覧"));

/// 2つ以上続く空白（merge.py の `\s{2,}`）
pub static SPACES2: LazyLock<Regex> = LazyLock::new(|| re(r"[\s\x1C-\x1F]{2,}"));

/// 自己紹介の強い形（speakers.py の STRONG_INTRO）。「と申しまして」も拾う
pub static STRONG_INTRO: LazyLock<[Regex; 2]> = LazyLock::new(|| {
    [
        re(&format!("{NAME}と申し(?:ます|まして)")),
        re(&format!(r"{NAME}です[。、]?[\s\x1C-\x1F]*(?:よろしく|宜しく)")),
    ]
});

/// 自己紹介の弱い形「の〇〇です」（冒頭付近だけで使う）
pub static WEAK_INTRO: LazyLock<Regex> = LazyLock::new(|| re(&format!("の{NAME}です")));

/// 呼びかけ「〇〇さん」
pub static ADDRESS: LazyLock<Regex> = LazyLock::new(|| re(&format!("{NAME}さん")));

/// 句読点の無い書き起こしで名前にくっつく一人称（「私山田」）
pub static SELF_PREFIX: LazyLock<Regex> = LazyLock::new(|| re(r"^(?:私|僕|俺|自分)"));

/// NeMo の出力1件の区切り（diarize.py の `[,\s]+`）
pub static NEMO_SPLIT: LazyLock<Regex> = LazyLock::new(|| re(r"[,\s\x1C-\x1F]+"));

/// 名前の文字の集まり（1文字）。突き合わせの確認用
pub static NAME_CHAR: LazyLock<Regex> = LazyLock::new(|| re(r"^[一-龥々〆ヵヶァ-ヴー]$"));

/// Python の `re.sub(r"\s{2,}", " ", s)`
pub fn collapse_spaces(s: &str) -> String {
    SPACES2.replace_all(s, " ").into_owned()
}

/// speakers.py の `_clean`（先頭の一人称を1つだけ外す）
pub fn clean_name(name: &str) -> String {
    SELF_PREFIX.replace(name, "").into_owned()
}
