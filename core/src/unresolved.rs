//! 確認用（話者を決められなかった部分）の名前の手がかり。
//!
//! 話者判定は録音の序盤の「誰の声か決めきれない発言」を出さない（C++ 版の既定の後処理）。その発言は確認用に回るので、
//! そこでの自己紹介が話者カードの手がかりから漏れる。これを拾って名前付けの画面に出す（contract 版2 の UnresolvedHint）。
//! どのラベルの人かは決めない（利用者が音声を聞いて話者カードと見比べる）。
//!
//! 規則は speakers の name_hints と同じで、話者付きの発言の代わりに確認用の発言を見る。
//! 聞かせる音声は、名乗った位置の約1秒前から（確認用の部分の頭より前にはしない。2026-09-26 決定）。
//! 呼びかけ直後は確認用の部分の頭から。文字も音声と同じ位置から見せる。

use std::io;
use std::path::Path;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::lang::Lang;
use crate::merge::{self, AssignedWord, Names, Turn, UNKNOWN, Word};
use crate::speakers::{self, CALLED, INTRO, Tally};
use crate::{patterns, pycompat, wav};

/// 名乗った位置の何秒前から聞かせるか
pub const LEAD: f64 = 1.0;
/// 話者カードのサンプル音声と同じ長さの上限
pub const MAX_SEC: f64 = 12.0;

/// contract の UnresolvedClip
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedClip {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub audio_path: String,
}

/// contract の UnresolvedHint
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UnresolvedHint {
    pub name: String,
    pub sources: IndexMap<String, i64>,
    pub clips: Vec<UnresolvedClip>,
}

/// merge の整形（2つ以上続く空白を1つに・前後の空白を除く）をし、各文字の元の位置（文字単位）も返す。
fn normalize_with_map(raw: &str) -> (String, Vec<usize>) {
    let chars: Vec<char> = raw.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(chars.len());
    let mut src: Vec<usize> = Vec::with_capacity(chars.len());
    let mut i = 0;
    for m in patterns::SPACES2.find_iter(raw) {
        let (ms, me) = (pycompat::char_index(raw, m.start()), pycompat::char_index(raw, m.end()));
        out.extend(&chars[i..ms]);
        src.extend(i..ms);
        out.push(' ');
        src.push(ms);
        i = me;
    }
    out.extend(&chars[i..]);
    src.extend(i..chars.len());
    let a = out.iter().position(|c| !pycompat::is_space(*c)).unwrap_or(out.len());
    let b = out.iter().rposition(|c| !pycompat::is_space(*c)).map_or(a, |x| x + 1);
    (out[a..b].iter().collect(), src[a..b].to_vec())
}

/// 発話（本文が空でないもの）と、その発話に属する語と、整えた本文の各文字の元の位置
struct Utt<'a> {
    utt: merge::Utterance,
    words: &'a [AssignedWord],
    src: Vec<usize>,
}

/// 確認用の発話 u の文字の位置 pos に出てきた名前を聞かせる範囲と、その範囲の文字（lang は録音の言語。文の長さに使う）。
fn clip_for(u: &Utt, pos: usize, lang: Lang) -> (f64, f64, String) {
    let mut t = None;
    if pos > 0 {
        let raw = u.src[pos];
        let mut acc = 0;
        for w in u.words {
            let l = pycompat::char_len(&w.word);
            if acc + l > raw {
                t = Some(w.start - LEAD); // 名前の最初の文字を含む語の約1秒前
                break;
            }
            acc += l;
        }
    }
    let (start, offset) = match t {
        Some(t) if t > u.words[0].start => {
            let j = u.words.iter().position(|w| w.start >= t).expect("名前の語より前に語がある");
            let raw_j: usize = u.words[..j].iter().map(|w| pycompat::char_len(&w.word)).sum();
            (pycompat::round(t, 2), u.src.partition_point(|&x| x < raw_j))
        }
        _ => (u.utt.start, 0),
    };
    let end = pycompat::min(u.utt.end, pycompat::round(start + MAX_SEC, 2));
    let body = speakers::excerpt(pycompat::skip(&u.utt.text, offset), speakers::excerpt_len(lang));
    (start, end, if offset > 0 { format!("…{body}") } else { body })
}

/// 画面向けの UnresolvedHint の一覧（件数の多い順）。audio と sample_dir があれば音声を `確認用_<n>.wav` に切り出す。
///
/// 入力は書き起こしの語と話者区間（transcript.json と同じ発話のまとめ方をなぞり、名前の位置の時刻を語から引く）。lang は録音の言語
pub fn unresolved_hints(
    words: &[Word],
    turns: &[Turn],
    audio: Option<&Path>,
    sample_dir: Option<&Path>,
    prefix: &str,
    lang: Lang,
) -> io::Result<Vec<UnresolvedHint>> {
    let assigned = merge::labeled_words(words, turns, 1.0, lang);
    let groups = merge::group_ranges(&assigned, &Names::new(), 1.5, 90.0, lang);
    let utts: Vec<Utt> = groups
        .into_iter()
        .filter(|g| !g.utt.text.is_empty())
        .map(|g| {
            let (text, src) = normalize_with_map(&g.raw);
            debug_assert_eq!(text, g.utt.text);
            Utt { words: &assigned[g.words.clone()], src, utt: g.utt }
        })
        .collect();
    let plain: Vec<merge::Utterance> = utts.iter().map(|u| u.utt.clone()).collect();
    let window = speakers::intro_limit(&plain, 600.0);

    // 名前 → 件数、名前 → {発話の番号: 名前の位置（最初のもの）}
    let mut tally = Tally::default();
    let mut places: IndexMap<String, IndexMap<usize, usize>> = IndexMap::new();
    let mut note = |name: &str, source: &str, k: usize, pos: usize| {
        tally.add(name, source);
        let w = places.entry(name.to_string()).or_default();
        let cur = w.get(&k).copied().unwrap_or(pos);
        w.insert(k, cur.min(pos));
    };
    let mut prev: Option<&merge::Utterance> = None;
    for (k, u) in plain.iter().enumerate() {
        if u.speaker != UNKNOWN {
            prev = Some(u);
            continue;
        }
        for (name, pos) in speakers::intro_names(&u.text, u.start <= window, lang) {
            note(&name, INTRO, k, pos);
        }
        if let Some(p) = prev
            && p.speaker != UNKNOWN
            && u.start - p.end <= 5.0
            && let Some(name) = speakers::called_name(&p.text, lang)
        {
            note(&name, CALLED, k, 0);
        }
        prev = Some(u);
    }

    let mut files: Vec<((f64, f64), String)> = Vec::new(); // 同じ範囲なら同じ音声を使い回す
    let mut out = Vec::new();
    for h in tally.ranked() {
        let mut where_: Vec<(usize, usize)> = places[&h.name].iter().map(|(&k, &p)| (k, p)).collect();
        where_.sort();
        let mut clips = Vec::new();
        for (k, pos) in where_ {
            let (start, end, text) = clip_for(&utts[k], pos, lang);
            let path = match files.iter().find(|(key, _)| *key == (start, end)) {
                Some((_, p)) => p.clone(),
                None => {
                    let fname = format!("確認用_{}.wav", files.len() + 1);
                    if let (Some(a), Some(d)) = (audio, sample_dir) {
                        wav::cut(a, start, end, &d.join(&fname), 0.2, MAX_SEC)?;
                    }
                    files.push(((start, end), format!("{prefix}{fname}")));
                    format!("{prefix}{fname}")
                }
            };
            clips.push(UnresolvedClip { start, end, text, audio_path: path });
        }
        out.push(UnresolvedHint { name: h.name, sources: h.sources, clips });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_keeps_original_positions() {
        let (t, src) = normalize_with_map("  a  b\u{3000}c ");
        assert_eq!(t, "a b\u{3000}c");
        assert_eq!(src, vec![2, 3, 5, 6, 7]);
    }
}
