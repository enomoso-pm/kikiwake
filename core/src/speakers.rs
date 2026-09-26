//! 話者を特定するための材料（移植元 `scripts/speakers.py`。数値も同じ）。
//!
//! 話者ラベル（話者A…）は匿名なので、誰が誰かは人が決める。序盤に声の似た2人が同じラベルに
//! まとめられることがあるので、話者ごとに序盤・中盤・終盤から1つずつサンプルを取り、発言内容と並べる。
//!
//! 名前の手がかり（推定。断定には使わない）:
//!   - 自己紹介: 「△△と申します」「△△です、よろしく…」、冒頭付近の「〇〇の△△です」
//!   - 呼びかけ: 直前に別の人が「△△さん」と呼び、その直後に話し始めた

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::merge::{self, Meta, Turn, UNKNOWN, Utterance};
use crate::{patterns, pycompat, pyjson, wav};

/// 名前として扱わない語（speakers.py の STOP）
pub const STOP: [&str; 38] = [
    "皆", "みな", "お客", "業者", "先方", "各", "担当", "奥", "他", "議題", "宿題", "資料", "予定", "以上", "確認", "本日",
    "今日", "課題", "問題", "内容", "件", "方", "形", "感じ", "認識", "想定", "結果", "理由", "場合", "対応", "必要",
    "予算", "前提", "目的", "話", "所", "事", "物",
];

pub const INTRO: &str = "自己紹介";
pub const CALLED: &str = "呼びかけ直後";

/// 名前の手がかり1件（speaker_hints.json と contract の NameHint と同じ形）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NameHint {
    pub name: String,
    /// 手がかりの種類 → 件数（見つけた順）。例 {"自己紹介": 2, "呼びかけ直後": 1}
    pub sources: IndexMap<String, i64>,
}

/// 話者ラベル → 手がかり（件数の多い順）。ラベルの並びは最初に手がかりが見つかった順
pub type Hints = IndexMap<String, Vec<NameHint>>;

pub(crate) fn is_stop(name: &str) -> bool {
    STOP.contains(&name)
}

/// 手がかりを数える入れ物（Python の defaultdict(Counter) と同じく、見つけた順を保つ）
#[derive(Default)]
pub(crate) struct Tally(IndexMap<String, IndexMap<String, i64>>);

impl Tally {
    pub fn add(&mut self, name: &str, source: &str) {
        *self.0.entry(name.to_string()).or_default().entry(source.to_string()).or_insert(0) += 1;
    }
    /// 件数の多い順（同じなら見つけた順）
    pub fn ranked(self) -> Vec<NameHint> {
        let mut v: Vec<NameHint> = self.0.into_iter().map(|(name, sources)| NameHint { name, sources }).collect();
        v.sort_by_key(|h| -h.sources.values().sum::<i64>());
        v
    }
}

/// 自己紹介の形に当てはまる名前（強い形はどこでも、弱い形は冒頭付近だけ）。見つけた順に (名前, 名前の始まりの文字位置)
pub(crate) fn intro_names(text: &str, weak: bool) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut scan = |rx: &regex::Regex| {
        for c in rx.captures_iter(text) {
            let g = c.get(1).expect("名前の括弧");
            let name = patterns::clean_name(g.as_str());
            if !name.is_empty() && !is_stop(&name) {
                let pos = pycompat::char_index(text, g.end()) - pycompat::char_len(&name);
                out.push((name, pos));
            }
        }
    };
    for rx in patterns::STRONG_INTRO.iter() {
        scan(rx);
    }
    if weak {
        scan(&patterns::WEAK_INTRO);
    }
    out
}

/// 直前の発言の末尾40字で呼ばれた名前（最後のもの）
pub(crate) fn called_name(prev_text: &str) -> Option<String> {
    patterns::ADDRESS
        .captures_iter(pycompat::tail(prev_text, 40))
        .map(|c| c[1].to_string())
        .filter(|n| !is_stop(n))
        .last()
}

/// 冒頭付近とみなす範囲（秒）: max(intro_window, 全体の15%)。全体は発話の終わりの最大値
pub(crate) fn intro_limit(utts: &[Utterance], intro_window: f64) -> f64 {
    let dur = utts.iter().map(|u| u.end).fold(None, |m: Option<f64>, e| Some(m.map_or(e, |m| pycompat::max(m, e))));
    pycompat::max(intro_window, dur.unwrap_or(0.0) * 0.15)
}

/// 話者ラベル → [候補名と、手がかりの種類ごとの件数]（件数の多い順）。既定は intro_window 600 秒
pub fn name_hints(utts: &[Utterance], intro_window: f64) -> Hints {
    let window = intro_limit(utts, intro_window);
    let mut hits: IndexMap<String, Tally> = IndexMap::new();
    let mut prev: Option<&Utterance> = None;
    for u in utts {
        let spk = &u.speaker;
        if spk == UNKNOWN {
            prev = Some(u);
            continue;
        }
        for (name, _) in intro_names(&u.text, u.start <= window) {
            hits.entry(spk.clone()).or_default().add(&name, INTRO);
        }
        if let Some(p) = prev
            && p.speaker != *spk
            && p.speaker != UNKNOWN
            && u.start - p.end <= 5.0
            && let Some(name) = called_name(&p.text)
        {
            hits.entry(spk.clone()).or_default().add(&name, CALLED);
        }
        prev = Some(u);
    }
    hits.into_iter().map(|(spk, t)| (spk, t.ranked())).collect()
}

// ---- サンプルの選び方 ------------------------------------------------------------------

/// 話者ごとに、時間順に n 等分した各区間から「target_sec に近い長さ」の発話を1つずつ選ぶ。
/// 声が重なった発話は避ける。条件に合う発話が無い話者は、長い順に拾う。既定は n 3・3〜20 秒・8 秒
pub fn pick_samples(utts: &[Utterance], n: usize, min_sec: f64, max_sec: f64, target_sec: f64) -> IndexMap<String, Vec<Utterance>> {
    let mut by: IndexMap<&str, Vec<&Utterance>> = IndexMap::new();
    for u in utts.iter().filter(|u| u.speaker != UNKNOWN) {
        by.entry(&u.speaker).or_default().push(u);
    }
    let mut picked = IndexMap::new();
    for (spk, lst) in by {
        let len = |u: &Utterance| u.end - u.start;
        let good: Vec<&Utterance> =
            lst.iter().copied().filter(|u| !u.overlap && min_sec <= len(u) && len(u) <= max_sec).collect();
        if good.is_empty() {
            let mut all = lst.clone();
            all.sort_by(|a, b| merge::cmp_f64(-len(a), -len(b)));
            picked.insert(spk.to_string(), all.into_iter().take(n).cloned().collect());
            continue;
        }
        let k = n.min(good.len());
        let mut chosen = Vec::with_capacity(k);
        for i in 0..k {
            let bucket = &good[i * good.len() / k..(i + 1) * good.len() / k];
            let mut best = bucket[0];
            for u in &bucket[1..] {
                if (len(u) - target_sec).abs() < (len(best) - target_sec).abs() {
                    best = u;
                }
            }
            chosen.push(best.clone());
        }
        picked.insert(spk.to_string(), chosen);
    }
    picked
}

/// 発言の冒頭 n 字（超えたら末尾に「…」）
pub fn excerpt(text: &str, n: usize) -> String {
    if pycompat::char_len(text) <= n { text.to_string() } else { format!("{}…", pycompat::head(text, n)) }
}

// ---- 出力 ---------------------------------------------------------------------------

/// Python の `float(meta.get("duration") or max((u["end"] for u in utts), default=0))`（transcript.md とは既定の取り方が違う）
fn duration_for_speakers(meta: &Meta, utts: &[Utterance]) -> f64 {
    match meta.duration {
        Some(d) if d != 0.0 => d,
        _ => utts.iter().map(|u| u.end).fold(None, |m: Option<f64>, e| Some(m.map_or(e, |m| pycompat::max(m, e)))).unwrap_or(0.0),
    }
}

/// out_dir の transcript.json / diarization.json / meta.json から speakers.md・speaker_hints.json・samples/ を作る。
pub fn write_speakers(out_dir: &Path) -> io::Result<PathBuf> {
    let utts: Vec<Utterance> = merge::load_json(&out_dir.join("transcript.json"))?;
    let turns: Vec<Turn> = merge::load_json(&out_dir.join("diarization.json"))?;
    let meta_p = out_dir.join("meta.json");
    let meta: Meta = if meta_p.exists() { merge::load_json(&meta_p)? } else { Meta::default() };
    let audio = PathBuf::from(meta.audio.clone().unwrap_or_default());
    let has_audio = !audio.as_os_str().is_empty() && audio.is_file();
    let long_form = duration_for_speakers(&meta, &utts) >= 3600.0;

    let tt = merge::talk_time(&turns, None);
    let total = merge::or_one(pycompat::sum(tt.values().copied()));
    let mut counts: HashMap<&str, usize> = HashMap::new();
    let mut first: HashMap<&str, f64> = HashMap::new();
    for u in &utts {
        *counts.entry(&u.speaker).or_insert(0) += 1;
        first.entry(&u.speaker).or_insert(u.start);
    }
    let hints = name_hints(&utts, 600.0);
    let samples = pick_samples(&utts, 3, 3.0, 20.0, 8.0);

    let sdir = out_dir.join("samples");
    if !sdir.is_dir() {
        fs::create_dir(&sdir)?;
    }
    let mut lines = vec![
        format!("# 話者の特定用メモ: {}", meta.title.clone().unwrap_or_default()),
        String::new(),
        "話者ラベルは声から自動で分けたもので、名前は付いていない。発言内容かサンプル音声で誰かを判断する。".to_string(),
        "同じ人が2つのラベルに割れていたら、両方に同じ名前を付ければ1人にまとまる。".to_string(),
        String::new(),
    ];
    if !has_audio {
        lines.push("> 音声キャッシュが見つからないため、サンプル音声は作っていない（発言内容のみ）。".to_string());
        lines.push(String::new());
    }
    for (spk, &sec) in &tt {
        lines.push(format!(
            "## {spk} — {}（{}）・発話 {}回・初登場 {}",
            merge::fmt_ts(sec, long_form),
            pycompat::percent0(sec / total),
            counts.get(spk.as_str()).copied().unwrap_or(0),
            merge::fmt_ts(first.get(spk.as_str()).copied().unwrap_or(0.0), long_form)
        ));
        if sec / total < 0.02 {
            lines.push(
                "- 注意: 発言時間がごく短い。他の人の声の一部や相づち・物音が別ラベルに分かれた可能性がある\
                 （サンプルで聞き、同じ人なら同じ名前を付けると1人にまとまる）"
                    .to_string(),
            );
        }
        match hints.get(spk) {
            Some(hs) if !hs.is_empty() => {
                let desc: Vec<String> = hs
                    .iter()
                    .take(3)
                    .map(|h| {
                        let src: Vec<String> = h.sources.iter().map(|(k, v)| format!("{k}{v}")).collect();
                        format!("{}（{}）", h.name, src.join("・"))
                    })
                    .collect();
                lines.push(format!("- 名前の手がかり（推定）: {}", desc.join("、")));
            }
            _ => lines.push("- 名前の手がかり: なし".to_string()),
        }
        lines.push("- サンプル:".to_string());
        for (i, u) in samples.get(spk).map(|v| v.as_slice()).unwrap_or(&[]).iter().enumerate() {
            let mut r = String::new();
            if has_audio {
                let name = format!("{spk}_{}.wav", i + 1);
                wav::cut(&audio, u.start, u.end, &sdir.join(&name), 0.2, 12.0)?;
                r = format!(" `samples/{name}`");
            }
            lines.push(format!("  - [{}]{r} 「{}」", merge::fmt_ts(u.start, long_form), excerpt(&u.text, 70)));
        }
        lines.push(String::new());
    }
    if let Some(&n) = counts.get(UNKNOWN).filter(|&&n| n > 0) {
        lines.push(format!(
            "※ 話者を決められなかった部分が {n} 件ある（無音部分の誤認識の可能性が高い。\
             transcript.md 末尾の「確認用」に隔離してある）。"
        ));
        lines.push(String::new());
    }
    let path = out_dir.join("speakers.md");
    fs::write(&path, lines.join("\n"))?;
    fs::write(out_dir.join("speaker_hints.json"), pyjson::dumps(&hints))?;
    Ok(path)
}
