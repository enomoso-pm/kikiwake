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

// ---- 英語の録音（2026-10-18。英語の文字起こし 1.2.0） -----------------------------------------------
// 移植元の Python 版には無い（日本語だけだった）。日本語の決まりと同じ考え方で、英語の言い回しに置き換えたもの。
// Rust の regex は前後を見る書き方（先読み・後読み）が無いので、区切りの記号も一致に含め、名前は括弧で取り出す。

/// 英語の名前の 1 語（頭が大文字で、あとが小文字。O'Brien・Mary-Jane・José も）。Whisper は文の頭と固有名詞だけを大文字で書く
const NAME_EN_WORD: &str = r"\p{Lu}\p{Ll}+(?:[-'’]\p{Lu}?\p{Ll}+)?";

/// 英語の名前（1〜2 語。「David」「Kenji Matsumoto」）
fn name_en() -> String {
    format!("({NAME_EN_WORD}(?: {NAME_EN_WORD})?)")
}

/// 英語の Whisper が無音や区間の切れ目で作り出す定番の文（会議では言わないものだけ。"Thank you." は会議でも言うので入れない）
pub static HALLUCINATION_EN: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)thanks? (?:you )?(?:so much |very much )?for watching|(?:please |and )?subscribe to (?:my|our|the) channel|like and subscribe|subtitles? (?:by|created by|provided by)|captions? by|transcri(?:bed|ption) by|amara\.org|\[blank_audio\]")
});

/// 英語の自己紹介の強い形（録音のどこでも）:
/// "My name is David" / "I'm Matsumoto, the project manager" / "I'm Sarah from …" / "This is Tom from …" / "Emily here."
pub static STRONG_INTRO_EN: LazyLock<[Regex; 4]> = LazyLock::new(|| {
    let n = name_en();
    [
        re(&format!(r"\b[Mm]y name(?: is|'s|’s) {n}")),
        re(&format!(r"\b(?:I'm|I’m|I am) {n}(?:, (?:the|a|an|your|from|with)\b| (?:from|with|here|speaking|on behalf of)\b)")),
        re(&format!(r"\b(?:[Tt]his is|[Ii]t's|[Ii]t’s) {n}(?:,? (?:from|with|here|speaking)\b|, (?:the|your)\b)")),
        re(&format!(r"(?:^|[.!?,] ){n} here(?:[.,!?]|$)")),
    ]
});

/// 英語の自己紹介の弱い形（冒頭付近だけで使う）: "I'm Tom." / "This is Tom," / "I'm Laura and I'm …"
pub static WEAK_INTRO_EN: LazyLock<Regex> =
    LazyLock::new(|| re(&format!(r"\b(?:I'm|I’m|I am|[Tt]his is) {}(?:[.,!?]| and\b|$)", name_en())));

/// 英語の呼びかけ（文の頭の名前のあとに読点と問いかけ・頼みごと）: "Tom, how did …" / "And David, could you …"
pub static ADDRESS_EN: LazyLock<Regex> = LazyLock::new(|| {
    re(&format!(
        r"(?:^|[.!?,;] |\b(?:[Ss]o|[Aa]nd|[Nn]ow|[Oo]kay|OK|[Rr]ight|[Ww]ell|[Tt]hen) ){}, (?:what|how|could|can|would|will|do|did|does|are|is|were|was|any|anything|have|has|you|your|please|tell|go|over|maybe|let|why|when|where|who|which|shall|should|I)\b",
        name_en()
    ))
});

/// 英語の呼びかけ（文の終わりの名前）: "What do you think, Sarah?" / "Over to you, Sarah."。
/// 「Thanks, Tom.」のようなお礼・あいさつは、呼んだ人のあとに話すとは限らないので、使う側（speakers）で除く
pub static ADDRESS_END_EN: LazyLock<Regex> = LazyLock::new(|| re(&format!(r",[\s\x1C-\x1F]+{}[.!?]?[\s\x1C-\x1F]*$", name_en())));

/// 英語の会議の日本式の呼びかけ: "Tanaka-san" / "Tanaka san"
pub static ADDRESS_SAN_EN: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"({NAME_EN_WORD})[- ]san\b")));

/// 呼びかけの直前にあると、呼びかけではなくお礼・あいさつ（"Thanks, Tom."）
pub static THANKS_EN: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\b(?:thanks|thank you|bye|goodbye|sorry|hi|hello|hey|morning|afternoon|evening|welcome|cheers|congratulations)\b[^.!?]*$"));

/// 英語で名前として扱わない語（文の頭で大文字になる語・曜日・月・国籍や言語の名前・役職。どの語でも当てはまれば名前にしない）。
/// 間投詞・あいづち・つなぎの言葉・あいさつも（2026-10-18。英語の会議で「Oh, I …」の Oh が、次に話した人の名前の手がかりになった）
pub const STOP_EN: &[&str] = &[
    "I", "Yes", "Yeah", "No", "Okay", "Ok", "So", "Well", "Now", "Right", "Sure", "Sorry", "Thanks", "Thank", "Hi", "Hello",
    "Hey", "Good", "Great", "Fine", "Alright", "Also", "Just", "Actually", "Basically", "Again", "Then", "Here", "There",
    "This", "That", "What", "How", "Why", "When", "Where", "Who", "Which", "Please", "Let", "Maybe", "Perhaps", "And", "But",
    "Or", "Everyone", "Everybody", "Anyone", "Anybody", "Someone", "Somebody", "Nobody", "All", "Guys", "Team", "Folks",
    "Sir", "Madam", "Mr", "Mrs", "Ms", "Miss", "Dr", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    "Sunday", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December", "Japanese", "English", "American", "British", "Chinese", "Korean", "French", "German", "Spanish", "Indian",
    "Project", "Manager", "Marketing", "Designer",
    // 間投詞・あいづち
    "Oh", "Ooh", "Ah", "Aha", "Uh", "Um", "Umm", "Er", "Erm", "Eh", "Hmm", "Hm", "Mm", "Mmm", "Mhm", "Mm-hmm", "Uh-huh",
    "Uh-oh", "Huh", "Wow", "Whoa", "Oops", "Gosh", "Ugh", "Yay", "Yep", "Yup", "Nope", "Nah", "Cool", "Nice", "Perfect",
    "Awesome", "Excellent", "Brilliant", "Wonderful", "Fantastic", "Lovely", "Interesting", "Exactly", "Absolutely",
    "Definitely", "Totally", "Certainly", "Indeed", "Really", "True", "Correct", "Agreed", "Fair",
    // つなぎの言葉（文の頭で読点が続く。「Today, I want to …」）
    "Anyway", "Anyways", "Anyhow", "However", "Otherwise", "Besides", "Meanwhile", "Instead", "Plus", "Still", "Though",
    "Although", "Because", "Like", "Look", "Listen", "See", "Wait", "First", "Firstly", "Second", "Secondly", "Third",
    "Finally", "Lastly", "Next", "Overall", "Therefore", "Thus", "Hence", "Moreover", "Furthermore", "Additionally",
    "Alternatively", "Similarly", "Regardless", "Nevertheless", "Nonetheless", "Honestly", "Seriously", "Frankly",
    "Obviously", "Clearly", "Apparently", "Hopefully", "Unfortunately", "Fortunately", "Luckily", "Thankfully", "Sadly",
    "Personally", "Ideally", "Generally", "Usually", "Normally", "Typically", "Essentially", "Technically", "Specifically",
    "Especially", "Particularly", "Interestingly", "Surprisingly", "Probably", "Possibly", "Literally", "Currently",
    "Initially", "Originally", "Eventually", "Recently", "Sometimes", "Today", "Tomorrow", "Yesterday", "Tonight", "Later",
    "Earlier", "Before", "Afterwards",
    // あいさつ・呼びかけの総称
    "Morning", "Afternoon", "Evening", "Bye", "Goodbye", "Cheers", "Welcome", "Congratulations", "Ladies", "Gentlemen",
    "Man", "Dude", "Buddy", "Mate",
];

/// 英語の名前の候補を整える。頭の STOP_EN の語は外し（"And David" → "David"。名前は 1〜2 語で取るので、文の頭の語を巻き込む）、
/// 残りの語が STOP_EN に当たれば名前にしない。返すのは（残した名前の、元の文字列の中のバイト位置, 名前）
pub fn clean_name_en(name: &str) -> Option<(usize, String)> {
    let mut start = 0;
    let mut rest = name;
    while let Some((head, tail)) = rest.split_once(' ') {
        if !STOP_EN.contains(&head) {
            break;
        }
        start += head.len() + 1;
        rest = tail;
    }
    (!rest.is_empty() && !rest.split(' ').any(|w| STOP_EN.contains(&w))).then(|| (start, rest.to_string()))
}
