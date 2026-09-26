//! 単語 × 話者区間 → 話者付きの発話（移植元 `scripts/merge.py`。数値も同じ）。
//!
//! Whisper が日本語で返す「単語」は「ク」「ラ」「ス」のような1〜数文字の断片なので、単語ごとに話者を決め、
//! 同じ話者が続く間を1つの発話にまとめる。
//!
//! 話者の決め方:
//!   1. 語の「末尾 tail 秒」と最も長く重なる話者
//!   2. どの区間とも重ならない語は、max_gap 秒以内で最寄りの話者
//!   3. それより離れた語は「不明」（無音区間の誤認識や話者判定の漏れの可能性）
//! 2人目の話者も判定区間の半分以上重なっていれば overlap（声の重なり）の印を付ける。
//! 末尾で判定するのは、Whisper が発話の最初の語の開始時刻を直前の無音へはみ出して早めに付けるため
//! （合成4人会議で、語全体 97.2% → 末尾 0.3 秒 99.3%）。
//!
//! 表示ラベルは初登場順に 話者A / 話者B / …。names で実名に置き換える（同じ名前のラベルは1人にまとまる）。

use std::fs;
use std::io;
use std::ops::Range;
use std::path::Path;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::{patterns, pycompat, pyjson};

pub const UNKNOWN: &str = "不明";

/// 書き起こしの語（words.json の1件）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub start: f64,
    pub end: f64,
    pub word: String,
}

/// 話者判定の区間（diarization.json の1件）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Turn {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
}

/// 話者を割り当てた語
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AssignedWord {
    pub start: f64,
    pub end: f64,
    pub word: String,
    pub speaker: String,
    pub overlap: bool,
}

/// 発話（transcript.json の1件。contract の Utterance）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Utterance {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
    pub text: String,
    pub overlap: bool,
}

/// ラベル → 名前（names.json）。キーは生ラベル（speaker_0）でも表示ラベル（話者A）でもよい。並びは読んだ順
pub type Names = IndexMap<String, String>;

/// 話者ごとの発言時間（秒）。多い順
pub type TalkTime = IndexMap<String, f64>;

/// meta.json のうち、ここで使う項目（ほかの項目は読み飛ばす）
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Meta {
    pub title: Option<String>,
    pub source: Option<String>,
    pub duration: Option<f64>,
    pub diarizer: Option<String>,
    pub asr: Option<String>,
    pub created: Option<String>,
    pub audio: Option<String>,
}

pub(crate) fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).expect("時刻に NaN がある")
}

// ---- 読み込み ------------------------------------------------------------------------

pub fn load_json<T: serde::de::DeserializeOwned>(path: &Path) -> io::Result<T> {
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("{}: {e}", path.display())))
}

/// 生ラベル（speaker_0 等）→ 初登場順の表示ラベル（話者A 等）。
pub fn label_map(turns: &[Turn]) -> IndexMap<String, String> {
    let mut sorted: Vec<&Turn> = turns.iter().collect();
    sorted.sort_by(|a, b| cmp_f64(a.start, b.start));
    let mut order: Vec<&str> = Vec::new();
    for t in sorted {
        if !order.contains(&t.speaker.as_str()) {
            order.push(&t.speaker);
        }
    }
    order
        .iter()
        .enumerate()
        .map(|(i, raw)| {
            let label = if i < 26 { format!("話者{}", (b'A' + i as u8) as char) } else { format!("話者{}", i + 1) };
            (raw.to_string(), label)
        })
        .collect()
}

// ---- 単語への話者割当 ---------------------------------------------------------------------

fn overlap_len(a0: f64, a1: f64, b0: f64, b1: f64) -> f64 {
    pycompat::max(0.0, pycompat::min(a1, b1) - pycompat::max(a0, b0))
}

/// 各語に speaker（生ラベル or 不明）と overlap を付けて返す。O(語数 + 区間数)。既定は max_gap 1.0・tail 0.3
pub fn assign_speakers(words: &[Word], turns: &[Turn], max_gap: f64, tail: f64) -> Vec<AssignedWord> {
    let mut turns: Vec<&Turn> = turns.iter().collect();
    turns.sort_by(|a, b| cmp_f64(a.start, b.start));
    let mut words: Vec<&Word> = words.iter().collect();
    words.sort_by(|a, b| cmp_f64(a.start, b.start));
    let mut out = Vec::with_capacity(words.len());
    let mut active: Vec<&Turn> = Vec::new();
    let mut j = 0;
    for w in words {
        let s0 = w.start;
        let mut e = w.end;
        if e <= s0 {
            e = s0 + 0.02; // 長さ0の語
        }
        let s = pycompat::max(s0, e - tail); // 末尾だけで判定する（冒頭の早すぎる開始時刻を無視）
        while j < turns.len() && turns[j].start < e + max_gap {
            active.push(turns[j]);
            j += 1;
        }
        active.retain(|t| t.end > s0 - max_gap); // 語は開始順なので s0 で刈れば取りこぼさない

        let mut by: IndexMap<&str, f64> = IndexMap::new();
        for t in &active {
            let o = overlap_len(s, e, t.start, t.end);
            if o > 0.0 {
                *by.entry(t.speaker.as_str()).or_insert(0.0) += o;
            }
        }
        let (speaker, overlap) = if !by.is_empty() {
            let mut ranked: Vec<(&str, f64)> = by.into_iter().collect();
            ranked.sort_by(|a, b| cmp_f64(-a.1, -b.1));
            let ov = ranked.len() > 1 && ranked[1].1 >= 0.5 * (e - s);
            (ranked[0].0.to_string(), ov)
        } else {
            // Python の min(near)。(隔たり, ラベル) の小さいほう。同じなら先のもの
            let mut best: Option<(f64, &str)> = None;
            for t in &active {
                let g = pycompat::max(t.start - e, s - t.end);
                let better = match best {
                    None => true,
                    Some((bg, bs)) => g < bg || (g == bg && t.speaker.as_str() < bs),
                };
                if better {
                    best = Some((g, t.speaker.as_str()));
                }
            }
            match best {
                Some((g, spk)) if !(g > max_gap) => (spk.to_string(), false),
                _ => (UNKNOWN.to_string(), false),
            }
        };
        out.push(AssignedWord { start: w.start, end: w.end, word: w.word.clone(), speaker, overlap });
    }
    out
}

// ---- 発話にまとめる --------------------------------------------------------------------

const SENT_END: [&str; 5] = ["。", "？", "！", "?", "!"];

/// まとめた発話と、その発話に属する語の範囲（assigned の添字）と、整える前の本文。
/// 本文が空になった発話も含む（group_utterances はそれを除く）。
pub(crate) struct Group {
    pub utt: Utterance,
    pub words: Range<usize>,
    pub raw: String,
}

pub(crate) fn group_ranges(assigned: &[AssignedWord], names: &Names, merge_gap: f64, max_utt_sec: f64) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    for (i, w) in assigned.iter().enumerate() {
        let who = names.get(&w.speaker).unwrap_or(&w.speaker);
        let same = match groups.last() {
            Some(g) => {
                let cur = &g.utt;
                cur.speaker == *who
                    && w.start - cur.end <= merge_gap
                    && !(cur.end - cur.start > max_utt_sec
                        && SENT_END.iter().any(|m| pycompat::rstrip(&g.raw).ends_with(m)))
            }
            None => false,
        };
        if same {
            let g = groups.last_mut().unwrap();
            g.utt.end = pycompat::max(g.utt.end, w.end);
            g.raw.push_str(&w.word);
            g.utt.overlap = g.utt.overlap || w.overlap;
            g.words.end = i + 1;
        } else {
            groups.push(Group {
                utt: Utterance { start: w.start, end: w.end, speaker: who.clone(), text: String::new(), overlap: w.overlap },
                words: i..i + 1,
                raw: w.word.clone(),
            });
        }
    }
    for g in &mut groups {
        g.utt.text = pycompat::strip(&patterns::collapse_spaces(&g.raw)).to_string();
        g.utt.start = pycompat::round(g.utt.start, 2);
        g.utt.end = pycompat::round(g.utt.end, 2);
    }
    groups
}

/// 同じ人が merge_gap 秒以内で話し続ける間を1発話にする。既定は merge_gap 1.5・max_utt_sec 90。
///
/// names はラベル → 表示名。同じ名前のラベルは同一人物として連結される。
/// 長い独話は max_utt_sec を超えたら文末で段落を切る。
pub fn group_utterances(assigned: &[AssignedWord], names: &Names, merge_gap: f64, max_utt_sec: f64) -> Vec<Utterance> {
    group_ranges(assigned, names, merge_gap, max_utt_sec)
        .into_iter()
        .filter(|g| !g.utt.text.is_empty())
        .map(|g| g.utt)
        .collect()
}

/// 定番の誤認識文を構成する語だけを「不明」にする（同じ人の本物の発言は本文に残す）。
pub fn flag_hallucinations(assigned: &mut [AssignedWord]) {
    let mut text = String::new();
    let mut spans = Vec::with_capacity(assigned.len());
    for w in assigned.iter() {
        spans.push((text.len(), text.len() + w.word.len()));
        text.push_str(&w.word);
    }
    for m in patterns::HALLUCINATION.find_iter(&text) {
        for (w, &(a, b)) in assigned.iter_mut().zip(&spans) {
            if a < m.end() && b > m.start() {
                w.speaker = UNKNOWN.to_string();
            }
        }
    }
}

/// names のキー（生ラベル・表示ラベルどちらでも）を表示ラベルにそろえる。
fn resolve_names(lm: &IndexMap<String, String>, names: Option<&Names>) -> Names {
    let mut resolved = Names::new();
    for (k, v) in names.into_iter().flatten() {
        resolved.insert(lm.get(k).unwrap_or(k).clone(), v.clone());
    }
    resolved
}

/// build_transcript の途中（名前を当てる前）: 表示ラベルに直し、誤認識文を「不明」にした語。
pub(crate) fn labeled_words(words: &[Word], turns: &[Turn], max_gap: f64) -> Vec<AssignedWord> {
    let lm = label_map(turns);
    let mut assigned = assign_speakers(words, turns, max_gap, 0.3);
    for w in &mut assigned {
        if let Some(label) = lm.get(&w.speaker) {
            w.speaker = label.clone();
        }
    }
    flag_hallucinations(&mut assigned);
    assigned
}

/// 生ラベルを表示ラベル（話者A…）に直してから、名前を当てて発話にまとめる。既定は max_gap 1.0・merge_gap 1.5
pub fn build_transcript(words: &[Word], turns: &[Turn], names: Option<&Names>, max_gap: f64, merge_gap: f64) -> Vec<Utterance> {
    let lm = label_map(turns);
    let assigned = labeled_words(words, turns, max_gap);
    let resolved = resolve_names(&lm, names);
    group_utterances(&assigned, &resolved, merge_gap, 90.0)
}

// ---- 集計・出力 ------------------------------------------------------------------------

/// 話者ごとの発話時間（秒）。話者判定の区間から数える（書き起こしの粒度に依存しない）。多い順
pub fn talk_time(turns: &[Turn], names: Option<&Names>) -> TalkTime {
    let lm = label_map(turns);
    let resolved = resolve_names(&lm, names);
    let mut tt: IndexMap<String, f64> = IndexMap::new();
    for t in turns {
        let label = &lm[&t.speaker];
        let who = resolved.get(label).unwrap_or(label);
        let cur = tt.get(who).copied().unwrap_or(0.0);
        tt.insert(who.clone(), cur + (t.end - t.start));
    }
    let mut items: Vec<(String, f64)> = tt.into_iter().collect();
    items.sort_by(|a, b| cmp_f64(-a.1, -b.1));
    items.into_iter().collect()
}

/// 時刻の表示。1時間以上の録音なら h:mm:ss、未満なら mm:ss（秒は切り捨て）
pub fn fmt_ts(sec: f64, long_form: bool) -> String {
    let t = pycompat::int(sec);
    let (h, m, s) = (t.div_euclid(3600), t.rem_euclid(3600).div_euclid(60), t.rem_euclid(60));
    if long_form { format!("{h}:{m:02}:{s:02}") } else { format!("{m:02}:{s:02}") }
}

/// Python の `float(meta.get("duration") or (utts[-1]["end"] if utts else 0))`
pub(crate) fn duration_of(meta: &Meta, utts: &[Utterance]) -> f64 {
    match meta.duration {
        Some(d) if d != 0.0 => d,
        _ => utts.last().map(|u| u.end).unwrap_or(0.0),
    }
}

pub fn render_markdown(utts: &[Utterance], meta: &Meta, tt: &TalkTime) -> String {
    let dur = duration_of(meta, utts);
    let long_form = dur >= 3600.0;
    let total = or_one(pycompat::sum(tt.values().copied()));
    let people: Vec<String> = tt
        .iter()
        .map(|(k, &v)| format!("{k} {}（{}）", fmt_ts(v, long_form), pycompat::percent0(v / total)))
        .collect();
    let get = |v: &Option<String>| v.clone().unwrap_or_default();
    let mut lines = vec![
        format!("# 話者付き文字起こし: {}", get(&meta.title)),
        String::new(),
        format!("- 元ファイル: {}", get(&meta.source)),
        format!("- 長さ: {} / 話者: {}人（{}）", fmt_ts(dur, long_form), tt.len(), people.join("、")),
        format!(
            "- 処理: 話者分離 {} / 文字起こし {} / {}",
            get(&meta.diarizer),
            get(&meta.asr),
            get(&meta.created)
        ),
        "- 話者は声から自動で推定したもの。`*` は他の人と声が重なっていた発話".to_string(),
        String::new(),
    ];
    for u in utts.iter().filter(|u| u.speaker != UNKNOWN) {
        let mark = if u.overlap { "*" } else { "" };
        lines.push(format!("[{}] {}{}: {}", fmt_ts(u.start, long_form), u.speaker, mark, u.text));
    }
    // 誰の声とも重ならない位置の文字は本文に混ぜない。消さずに残して人が確かめる
    let unknown: Vec<&Utterance> = utts.iter().filter(|u| u.speaker == UNKNOWN).collect();
    if !unknown.is_empty() {
        lines.extend(
            [
                "",
                "---",
                "",
                "## 確認用: 話者を決められなかった部分",
                "",
                "誰の声とも重ならない位置に書き起こされた文字。無音部分の誤認識であることが多いが、\
                 話者分離の取りこぼしの可能性もあるので、必要なら元の録画で確かめる。",
                "",
            ]
            .map(String::from),
        );
        lines.extend(unknown.iter().map(|u| format!("[{}] {}", fmt_ts(u.start, long_form), u.text)));
    }
    lines.join("\n") + "\n"
}

/// Python の `x or 1.0`（0 なら 1.0）
pub(crate) fn or_one(x: f64) -> f64 {
    if x == 0.0 { 1.0 } else { x }
}

/// write_outputs の戻り値
#[derive(Clone, Debug, Serialize)]
pub struct WriteSummary {
    pub utterances: usize,
    pub speakers: Vec<String>,
    pub unknown_ratio: f64,
    pub md: String,
}

/// out_dir の words.json / diarization.json / meta.json から書き起こしを作る。
///
/// names が無ければ（空でも）transcript.{json,md}、あれば transcript_named.{json,md} を書く。
pub fn write_outputs(out_dir: &Path, names: Option<&Names>) -> io::Result<WriteSummary> {
    let words: Vec<Word> = load_json(&out_dir.join("words.json"))?;
    let turns: Vec<Turn> = load_json(&out_dir.join("diarization.json"))?;
    let meta_p = out_dir.join("meta.json");
    let meta: Meta = if meta_p.exists() { load_json(&meta_p)? } else { Meta::default() };
    let names = names.filter(|n| !n.is_empty());
    let utts = build_transcript(&words, &turns, names, 1.0, 1.5);
    let tt = talk_time(&turns, names);
    let stem = if names.is_some() { "transcript_named" } else { "transcript" };
    fs::write(out_dir.join(format!("{stem}.json")), pyjson::dumps(&utts))?;
    let md = out_dir.join(format!("{stem}.md"));
    fs::write(&md, render_markdown(&utts, &meta, &tt))?;
    let unknown_chars: usize = utts.iter().filter(|u| u.speaker == UNKNOWN).map(|u| pycompat::char_len(&u.text)).sum();
    let all_chars: usize = utts.iter().map(|u| pycompat::char_len(&u.text)).sum();
    Ok(WriteSummary {
        utterances: utts.len(),
        speakers: tt.keys().cloned().collect(),
        unknown_ratio: unknown_chars as f64 / all_chars.max(1) as f64,
        md: md.display().to_string(),
    })
}
