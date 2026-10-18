//! 受け渡しの約束 版3: 結果の画面の行（Line）と、手直しを当てた保存（画面側の依頼 R2〜R6）。
//!
//! 決めたこと（2026-09-26）:
//!   - 結果の画面の行は、名前を付ける前の書き起こし（transcript.json と同じ区切り）。行ごとに変わらない id（u0, u1, …）を付け、
//!     名前付けをやり直しても区切りも id も変わらない（R6）。同じ名前のラベルの隣り合う行も、画面ではまとめない
//!   - 行ごとの名前・確認用の確定・直した文字は画面側が持ち、保存のときに渡す（R2〜R4。アプリを閉じると消える）
//!   - 保存では手直しを当ててから、同じ名前の隣り合う行を Python 版と同じ条件（1.5 秒以内・90 秒を超えたら文末で区切る）で1行にまとめる。
//!     行の元の文字（空白を整える前）と丸める前の時刻でつなぐので、手直しが無ければ Python 版の実名版と一字一句同じになる
//!     （合成会議 519 通り・実録音 9 通りで確認）
//!   - .txt は本文の行だけ（見出しは入れず、確認用は末尾に）
//!   - 保存先に同じ名前のファイルがあれば、上書きしてよいか画面が確かめる（`overwrite` が無ければ書かずに一覧を返す）
//!   - 版7（2026-09-27）: 英語の画面で保存すると、見出し・確認用の欄・「話者A」「不明」を英語にする（crate::lang。日本語は変えない）

use std::fs;
use std::io;
use std::path::Path;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::lang::Lang;
use crate::merge::{self, Meta, Names, TalkTime, Turn, UNKNOWN, Utterance, Word};
use crate::{patterns, pycompat, pyjson};

/// contract の Line（結果の画面の1行）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub id: String,
    pub start: f64,
    pub end: f64,
    /// 話者A…（確認用は「不明」）
    pub label: String,
    /// 名前付けで当てた名前（無ければラベル。確認用は「不明」）
    pub speaker: String,
    /// 書き起こしの文字（手直しの前）
    pub text: String,
    pub overlap: bool,
}

/// 行と、保存でまとめるときに使う元の文字・丸める前の時刻（画面には出さない）
#[derive(Clone, Debug)]
pub struct LineRow {
    pub line: Line,
    raw: String,
    raw_start: f64,
    raw_end: f64,
}

/// contract の LineEdits（保存のときに画面から渡る手直し）
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LineEdits {
    /// 行の id → その行だけの名前（確認用の行に名前を付けるのもここ）
    pub names: IndexMap<String, String>,
    /// 確定した確認用の行の id（本文に入れる）
    pub confirmed: Vec<String>,
    /// 行の id → 直した後の文字
    pub texts: IndexMap<String, String>,
}

/// contract の SaveFormat
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveFormat {
    Md,
    Txt,
    Json,
}

/// contract の SaveResult
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SaveResult {
    /// 書き出したファイルのパス（確かめが要るときは空）
    pub files: Vec<String>,
    /// 保存先に同じ名前のファイルがあり、上書きの指定が無かったとき、そのパス（何も書いていない）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub existing: Vec<String>,
}

/// 画面から来た名前を整える: 前後の空白（全角も）を除き、空の名前は「付けていない」として外す。
pub fn clean_names(names: Option<&Names>) -> Names {
    let mut out = Names::new();
    for (k, v) in names.into_iter().flatten() {
        let v = pycompat::strip(v);
        if !v.is_empty() {
            out.insert(k.clone(), v.to_string());
        }
    }
    out
}

/// 結果の画面の行。名前を付ける前の発話に、変わらない id・ラベル・当てた名前を付ける。lang は録音の言語
pub fn lines(words: &[Word], turns: &[Turn], names: Option<&Names>, lang: Lang) -> Vec<LineRow> {
    let lm = merge::label_map(turns);
    let mut resolved = Names::new();
    for (k, v) in clean_names(names) {
        resolved.insert(lm.get(&k).cloned().unwrap_or(k), v);
    }
    let assigned = merge::labeled_words(words, turns, 1.0, lang);
    merge::group_ranges(&assigned, &Names::new(), 1.5, 90.0, lang)
        .into_iter()
        .filter(|g| !g.utt.text.is_empty())
        .enumerate()
        .map(|(i, g)| {
            let ws = &assigned[g.words.clone()];
            let label = g.utt.speaker.clone();
            let speaker =
                if label == UNKNOWN { label.clone() } else { resolved.get(&label).cloned().unwrap_or_else(|| label.clone()) };
            let raw_end = ws.iter().skip(1).fold(ws[0].end, |m, w| pycompat::max(m, w.end));
            LineRow {
                line: Line {
                    id: format!("u{i}"),
                    start: g.utt.start,
                    end: g.utt.end,
                    label,
                    speaker,
                    text: g.utt.text,
                    overlap: g.utt.overlap,
                },
                raw: g.raw,
                raw_start: ws[0].start,
                raw_end,
            }
        })
        .collect()
}

/// 直した文字を整える（改行は空白に、前後の空白を除く）
fn clean_text(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut in_break = false;
    for c in t.chars() {
        if c == '\r' || c == '\n' {
            if !in_break {
                out.push(' ');
            }
            in_break = true;
        } else {
            out.push(c);
            in_break = false;
        }
    }
    pycompat::strip(&out).to_string()
}

/// 手直しを当てた行（保存用）
#[derive(Clone, Debug)]
struct Edited {
    speaker: String,
    raw: String,
    raw_start: f64,
    raw_end: f64,
    overlap: bool,
}

fn edited(rows: &[LineRow], edits: &LineEdits) -> Vec<Edited> {
    let names = clean_names(Some(&edits.names));
    rows.iter()
        .map(|r| {
            let id = &r.line.id;
            let t = edits.texts.get(id).map(|t| clean_text(t)).unwrap_or_default();
            let speaker = if r.line.label == UNKNOWN {
                match names.get(id) {
                    Some(n) if edits.confirmed.contains(id) => n.clone(),
                    _ => UNKNOWN.to_string(),
                }
            } else {
                names.get(id).cloned().unwrap_or_else(|| r.line.speaker.clone())
            };
            Edited {
                speaker,
                raw: if t.is_empty() { r.raw.clone() } else { t },
                raw_start: r.raw_start,
                raw_end: r.raw_end,
                overlap: r.line.overlap,
            }
        })
        .collect()
}

/// 同じ名前の隣り合う行を1行にまとめる（merge の group_utterances と同じ条件を、行の単位で）。文末の記号は録音の言語 lang で決める
fn merge_rows(rows: &[Edited], merge_gap: f64, max_utt_sec: f64, lang: Lang) -> Vec<Utterance> {
    let ends = merge::sent_end(lang);
    let mut groups: Vec<Edited> = Vec::new();
    for r in rows {
        let join = match groups.last() {
            Some(cur) => {
                cur.speaker == r.speaker
                    && r.raw_start - cur.raw_end <= merge_gap
                    && !(cur.raw_end - cur.raw_start > max_utt_sec && ends.iter().any(|m| pycompat::rstrip(&cur.raw).ends_with(m)))
            }
            None => false,
        };
        if join {
            let cur = groups.last_mut().unwrap();
            cur.raw_end = pycompat::max(cur.raw_end, r.raw_end);
            cur.raw.push_str(&r.raw);
            cur.overlap = cur.overlap || r.overlap;
        } else {
            groups.push(r.clone());
        }
    }
    groups
        .into_iter()
        .filter_map(|g| {
            let text = pycompat::strip(&patterns::collapse_spaces(&g.raw)).to_string();
            (!text.is_empty()).then(|| Utterance {
                start: pycompat::round(g.raw_start, 2),
                end: pycompat::round(g.raw_end, 2),
                speaker: g.speaker,
                text,
                overlap: g.overlap,
            })
        })
        .collect()
}

/// 保存する .md の見出しの発言時間。話者判定の区間から数え（Python 版と同じ）、行ごとに名前を変えた行と
/// 確定した確認用の行の長さを、元の名前から付けた名前へ移す。0 以下になった名前は外す。
fn saved_talk_time(turns: &[Turn], names: Option<&Names>, rows: &[LineRow], ed: &[Edited]) -> TalkTime {
    let names = clean_names(names);
    let mut tt = merge::talk_time(turns, Some(&names));
    for (r, e) in rows.iter().zip(ed) {
        if e.speaker == r.line.speaker {
            continue;
        }
        let d = r.line.end - r.line.start;
        if r.line.speaker != UNKNOWN {
            let cur = tt.get(&r.line.speaker).copied().unwrap_or(0.0);
            tt.insert(r.line.speaker.clone(), pycompat::max(0.0, cur - d));
        }
        if e.speaker != UNKNOWN {
            let cur = tt.get(&e.speaker).copied().unwrap_or(0.0);
            tt.insert(e.speaker.clone(), cur + d);
        }
    }
    let mut items: Vec<(String, f64)> = tt.into_iter().filter(|(_, v)| *v > 0.0).collect();
    items.sort_by(|a, b| merge::cmp_f64(-a.1, -b.1));
    items.into_iter().collect()
}

/// .txt: 本文の行だけ（見出しは入れない）。確認用は末尾に。英語（約束 版7）では確認用の見出しと「話者A」を英語にする
pub fn render_txt(utts: &[Utterance], meta: &Meta, lang: Lang) -> String {
    let long_form = merge::duration_of(meta, utts) >= 3600.0;
    let line = |u: &Utterance| {
        let who = crate::lang::speaker(lang, &u.speaker);
        format!("[{}] {}{}: {}", merge::fmt_ts(u.start, long_form), who, if u.overlap { "*" } else { "" }, u.text)
    };
    let mut out: Vec<String> = utts.iter().filter(|u| u.speaker != UNKNOWN).map(line).collect();
    let unknown: Vec<&Utterance> = utts.iter().filter(|u| u.speaker == UNKNOWN).collect();
    if !unknown.is_empty() {
        out.push(String::new());
        out.push(
            match lang {
                Lang::Ja => "確認用（話者を決められなかった部分）",
                Lang::En => "Unassigned (parts without a speaker)",
            }
            .to_string(),
        );
        out.extend(unknown.iter().map(|u| format!("[{}] {}", merge::fmt_ts(u.start, long_form), u.text)));
    }
    out.join("\n") + "\n"
}

/// 保存する中身 [(ファイル名, 文字列)]。名前が1つでも使われていれば transcript_named.*、無ければ transcript.*（Python 版と同じ名前）。
/// アプリの保存では、エンジンが録音の名前入り（「<元の名前>_文字起こし.md」。約束 版12）に付け替える（中身はこのまま）。
/// lang は画面の言語（約束 版7）。日本語は Python 版と同じ中身、英語は見出し・確認用の欄・「話者A」「不明」を英語にする（ファイル名は同じ）。
/// 録音の言語（行のまとめ方・誤認識文のよけ方）は meta の language（無ければ日本語）
pub fn save_files(
    words: &[Word],
    turns: &[Turn],
    names: Option<&Names>,
    edits: &LineEdits,
    meta: &Meta,
    formats: &[SaveFormat],
    lang: Lang,
) -> Vec<(String, String)> {
    let speech = meta.speech_lang();
    let rows = lines(words, turns, names, speech);
    let ed = edited(&rows, edits);
    let utts = merge_rows(&ed, 1.5, 90.0, speech);
    let tt = saved_talk_time(turns, names, &rows, &ed);
    let named = rows.iter().zip(&ed).any(|(r, e)| e.speaker != r.line.label && e.speaker != UNKNOWN);
    let stem = if named { "transcript_named" } else { "transcript" };
    formats
        .iter()
        .map(|f| match (f, lang) {
            (SaveFormat::Md, Lang::Ja) => (format!("{stem}.md"), merge::render_markdown(&utts, meta, &tt)),
            (SaveFormat::Md, Lang::En) => (format!("{stem}.md"), merge::render_markdown_en(&utts, meta, &tt)),
            (SaveFormat::Txt, _) => (format!("{stem}.txt"), render_txt(&utts, meta, lang)),
            (SaveFormat::Json, Lang::Ja) => (format!("{stem}.json"), pyjson::dumps(&utts)),
            (SaveFormat::Json, Lang::En) => {
                let en: Vec<Utterance> =
                    utts.iter().map(|u| Utterance { speaker: crate::lang::speaker_en(&u.speaker).into_owned(), ..u.clone() }).collect();
                (format!("{stem}.json"), pyjson::dumps(&en))
            }
        })
        .collect()
}

/// 保存するファイルと同じ発言（手直しを当て、同じ名前の隣り合う行を1行にまとめたもの。確認用も含む）。
/// マニュアルの素材の timeline で、区間ごとに発言を並べるのに使う（screens.rs）。lang は録音の言語
pub fn saved_utterances(words: &[Word], turns: &[Turn], names: Option<&Names>, edits: &LineEdits, lang: Lang) -> Vec<Utterance> {
    let rows = lines(words, turns, names, lang);
    merge_rows(&edited(&rows, edits), 1.5, 90.0, lang)
}

/// 保存先に書く。同じ名前のファイルがあり overwrite でないときは、何も書かずにその一覧を返す（画面が確かめる）。
pub fn write_files(dir: &Path, files: &[(String, String)], overwrite: bool) -> io::Result<SaveResult> {
    let paths: Vec<std::path::PathBuf> = files.iter().map(|(n, _)| dir.join(n)).collect();
    let existing: Vec<String> = paths.iter().filter(|p| p.exists()).map(|p| p.display().to_string()).collect();
    if !existing.is_empty() && !overwrite {
        return Ok(SaveResult { files: Vec::new(), existing });
    }
    fs::create_dir_all(dir)?;
    for (p, (_, content)) in paths.iter().zip(files) {
        fs::write(p, content)?;
    }
    Ok(SaveResult { files: paths.iter().map(|p| p.display().to_string()).collect(), existing: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_text_joins_lines() {
        assert_eq!(clean_text("  直した\r\n文字\n\nです\u{3000}"), "直した 文字 です");
        assert_eq!(clean_text(" \n "), "");
    }
}
