//! whisper.cpp の書き起こし → 語（Phase 0 の実測で決めた「DTW＋区切りの終わりで頭打ち」）。
//!
//! 語の単位は MLX Whisper（Python 版が使っていたもの）と同じにする:
//!   - whisper-cli の `-ojf` は、1文字にまたがる複数のトークンを1件にまとめ、`id` は先頭のものだけ残す。
//!     `id` から語彙を引き直すと残りのバイトが欠けて「�」になるので、`text` をそのまま使う
//!   - `id >= 50257` のトークン（[_BEG_]・時刻トークン）は除く
//!   - 語の始まり = `t_dtw / 100`。終わり = 同じ区切り（segment）の次のトークンの `t_dtw`。区切りの最後のトークンは
//!     `min(offsets.to, 区切りの終わり)`。そのうえで語の終わりを区切りの終わりで頭打ちにする
//!     （句点の DTW 時刻が次の人の話し始めまで 0.4〜1 秒遅れ、直前の語が次の話者に食い込んでいた。割当のみ turbo 91.6% → 99.3%）
//!   - 句読点は MLX Whisper の `merge_punctuations` と同じ規則で前後の語にくっつける（時刻はくっつけた先の語のまま）
//!   - 本家 Whisper の他の後処理（中央値による切り詰め等）は入れない（whisper.cpp の時刻では割当のみが 99.5% → 96.4% に悪化）
//!
//! JSON の読み取り（`parse_ojf`）と変換（`to_words`）は分けてある。Phase 2 で whisper.cpp の呼び出し口を自作したら、
//! そちらから `Segment` を作って `to_words` に渡す。

use serde::{Deserialize, Serialize};

use crate::pycompat;

/// これ以上の id は [_BEG_] や時刻トークン（語ではない）
pub const EOT: i64 = 50257;
/// 後ろの語にくっつける記号（MLX Whisper の既定）
pub const PREPEND: &str = "\"'“¿([{-";
/// 前の語にくっつける記号（MLX Whisper の既定）
pub const APPEND: &str = "\"'.。,，!！?？:：”)]}、";

#[derive(Clone, Debug, Deserialize)]
pub struct Offsets {
    pub from: i64,
    pub to: i64,
}

/// whisper-cli -ojf のトークン1件（使う項目だけ）
#[derive(Clone, Debug, Deserialize)]
pub struct Token {
    pub text: String,
    pub id: i64,
    pub p: f64,
    /// DTW で求めたトークンの始まり（10ms 単位）。求めていなければ -1。
    /// whisper-cli は小数として書く（cli.cpp の value_f）。1,000,000 以上（録音の 2 時間 46 分 40 秒以降）は
    /// 「1e+06」のような有効数字 6 桁の指数表記になるので、小数でも読む（Python の json.loads と同じ値になる）
    #[serde(deserialize_with = "int_or_float")]
    pub t_dtw: i64,
    pub offsets: Offsets,
}

/// whisper-cli -ojf の区切り1件（時刻トークンで区切られたまとまり）
#[derive(Clone, Debug, Deserialize)]
pub struct Segment {
    pub offsets: Offsets,
    #[serde(default)]
    pub text: String,
    pub tokens: Vec<Token>,
}

/// 整数でも小数（指数表記を含む）でも読み、整数にする（t_dtw は整数の値しか取らない）
fn int_or_float<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    Ok(f64::deserialize(d)?.round() as i64)
}

#[derive(Deserialize)]
struct OjfDoc {
    transcription: Vec<Segment>,
}

/// 書き起こしの語（words.json の1件。p はトークンの確からしさ）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WordP {
    pub start: f64,
    pub end: f64,
    pub word: String,
    pub p: f64,
}

/// whisper-cli `-ojf` の JSON を読む。
pub fn parse_ojf(json: &str) -> serde_json::Result<Vec<Segment>> {
    Ok(serde_json::from_str::<OjfDoc>(json)?.transcription)
}

struct Timing {
    word: String,
    start: f64,
    end: f64,
    p: f64,
}

/// MLX Whisper の merge_punctuations と同じ（「記号の一覧に含まれるか」は部分文字列の判定。空文字も含まれる扱い）。
fn merge_punctuations(al: &mut [Timing], prepended: &str, appended: &str) {
    // 前に付く記号を後ろの語へ
    if al.len() >= 2 {
        let mut i = al.len() as isize - 2;
        let mut j = al.len() - 1;
        while i >= 0 {
            let iu = i as usize;
            if al[iu].word.starts_with(' ') && prepended.contains(pycompat::strip(&al[iu].word)) {
                let moved = std::mem::take(&mut al[iu].word);
                al[j].word = moved + &al[j].word;
            } else {
                j = iu;
            }
            i -= 1;
        }
    }
    // 後ろに付く記号を前の語へ
    let mut i = 0;
    let mut j = 1;
    while j < al.len() {
        if !al[i].word.ends_with(' ') && appended.contains(al[j].word.as_str()) {
            let moved = std::mem::take(&mut al[j].word);
            al[i].word.push_str(&moved);
        } else {
            i = j;
        }
        j += 1;
    }
}

/// 区切りの並び → 語（MLX Whisper と同じ単位）。時刻と確からしさは小数3桁に丸める。
pub fn to_words(segments: &[Segment]) -> Vec<WordP> {
    let mut out = Vec::new();
    for seg in segments {
        let toks: Vec<&Token> = seg.tokens.iter().filter(|t| t.id < EOT).collect();
        if toks.is_empty() {
            continue;
        }
        let seg_end = seg.offsets.to as f64 / 1000.0;
        let mut al: Vec<Timing> = Vec::with_capacity(toks.len());
        for (i, t) in toks.iter().enumerate() {
            let s = t.t_dtw as f64 / 100.0;
            let nxt = toks.get(i + 1).map(|n| n.t_dtw as f64 / 100.0);
            let mut e = match nxt {
                Some(n) if n >= s => n,
                _ => pycompat::max(s, pycompat::min(t.offsets.to as f64 / 1000.0, seg_end)),
            };
            if e > seg_end {
                e = if s <= seg_end { pycompat::max(seg_end, s) } else { s }; // 区切りの終わりで頭打ち（始まりより前にはしない）
            }
            al.push(Timing { word: t.text.clone(), start: s, end: e, p: t.p });
        }
        merge_punctuations(&mut al, PREPEND, APPEND);
        out.extend(al.into_iter().filter(|a| !a.word.is_empty()).map(|a| WordP {
            start: pycompat::round(a.start, 3),
            end: pycompat::round(a.end, 3),
            word: a.word,
            p: pycompat::round(a.p, 3),
        }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tok(text: &str, id: i64, t_dtw: i64, to: i64) -> Token {
        Token { text: text.into(), id, p: 0.9, t_dtw, offsets: Offsets { from: 0, to } }
    }

    fn seg(to: i64, tokens: Vec<Token>) -> Segment {
        Segment { offsets: Offsets { from: 0, to }, text: String::new(), tokens }
    }

    #[test]
    fn skips_special_tokens_and_uses_text_as_is() {
        let s = seg(2000, vec![tok("[_BEG_]", 50365, -1, 0), tok("本", 8802, 10, 500), tok("日", 6890, 60, 900), tok("[_TT_100]", 50465, 100, 1000)]);
        let w = to_words(&[s]);
        assert_eq!(w.iter().map(|w| w.word.as_str()).collect::<Vec<_>>(), ["本", "日"]);
        assert_eq!((w[0].start, w[0].end), (0.1, 0.6)); // 終わりは次のトークンの t_dtw
        assert_eq!((w[1].start, w[1].end), (0.6, 0.9)); // 区切りの最後は min(offsets.to, 区切りの終わり)
    }

    #[test]
    fn end_is_capped_at_segment_end() {
        // 句点の t_dtw が区切りの終わり（1.0 秒）より遅れている → 直前の語の終わりを 1.0 秒で頭打ち
        let s = seg(1000, vec![tok("です", 1, 50, 900), tok("。", 2, 180, 1000)]);
        let w = to_words(&[s]);
        assert_eq!(w.len(), 1);
        assert_eq!((w[0].word.as_str(), w[0].start, w[0].end), ("です。", 0.5, 1.0));
    }

    #[test]
    fn punctuation_joins_neighbours() {
        let s = seg(3000, vec![tok(" (", 1, 10, 100), tok("注", 2, 20, 200), tok(")", 3, 30, 300), tok("、", 4, 40, 400)]);
        let w = to_words(&[s]);
        assert_eq!(w.iter().map(|w| w.word.as_str()).collect::<Vec<_>>(), [" (注)、"]);
    }

    /// 録音の 2 時間 46 分 40 秒以降、whisper-cli は t_dtw を指数表記で書く（4.5 時間の試験音声で 28,289 か所）
    #[test]
    fn reads_t_dtw_written_as_float() {
        let json = r#"{"transcription": [{"offsets": {"from": 9999920, "to": 10001300}, "text": "あい", "tokens": [
            {"text": "あ", "id": 1, "p": 0.9, "t_dtw": 999992, "offsets": {"from": 9999920, "to": 10000040}},
            {"text": "い", "id": 2, "p": 0.9, "t_dtw": 1e+06, "offsets": {"from": 10000040, "to": 10000100}},
            {"text": "う", "id": 3, "p": 0.9, "t_dtw": 1.00012e+06, "offsets": {"from": 10000100, "to": 10001300}}]}]}"#;
        let segs = parse_ojf(json).unwrap();
        assert_eq!(segs[0].tokens.iter().map(|t| t.t_dtw).collect::<Vec<_>>(), [999992, 1000000, 1000120]);
    }
}
