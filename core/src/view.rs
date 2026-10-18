//! 画面向けのデータ（contract/types.ts の SpeakerCard・TranscriptView）。
//!
//! 中身は speakers.md・transcript.md と同じ材料（発言時間・手がかり・サンプル）で、形だけ画面に合わせる。
//! 注意の表示: short_talk は発言時間が全体の2%未満、mixed_voices は1つのラベルに違う名前の自己紹介が2人分以上
//! （呼びかけ直後だけの名前は数えない。2026-09-26 決定。「手がかりの名前が2種類以上」では、実録音の2人の対話で主要な2人の両方に誤って出た）。

use std::collections::HashMap;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::lang::Lang;
use crate::lines::Line;
use crate::merge::{self, Meta, TalkTime, Turn, UNKNOWN, Utterance};
use crate::speakers::{self, NameHint};
use crate::{pycompat, wav};

/// contract の SpeakerSample
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerSample {
    pub index: usize,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub audio_path: String,
}

/// contract の SpeakerCard
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerCard {
    pub label: String,
    pub talk_sec: f64,
    pub share: f64,
    pub utterances: usize,
    pub first_sec: f64,
    pub hints: Vec<NameHint>,
    pub samples: Vec<SpeakerSample>,
    pub warnings: Vec<String>,
}

/// contract の TalkTime
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TalkTimeItem {
    pub speaker: String,
    pub sec: f64,
    pub share: f64,
}

/// contract の TranscriptView（版3: 行は Line。名前を付ける前の区切りのまま、名前でまとめない）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptView {
    pub title: String,
    pub source: String,
    pub duration_sec: f64,
    pub created_at: String,
    pub diarizer: String,
    pub asr: String,
    pub named: bool,
    pub talk_time: Vec<TalkTimeItem>,
    pub utterances: Vec<Line>,
    pub unresolved: Vec<Line>,
}

/// 話者カード（発言時間の多い順。speakers.md と同じ並び）。サンプル音声は sample_dir に `<ラベル>_<n>.wav` で切り出す。
pub fn speaker_cards(
    utts: &[Utterance],
    turns: &[Turn],
    audio: &Path,
    sample_dir: &Path,
    prefix: &str,
    lang: Lang,
) -> io::Result<Vec<SpeakerCard>> {
    let tt = merge::talk_time(turns, None);
    let total = merge::or_one(pycompat::sum(tt.values().copied()));
    let mut counts: HashMap<&str, usize> = HashMap::new();
    let mut first: HashMap<&str, f64> = HashMap::new();
    for u in utts {
        *counts.entry(&u.speaker).or_insert(0) += 1;
        first.entry(&u.speaker).or_insert(u.start);
    }
    let hints = speakers::name_hints(utts, 600.0, lang);
    let samples = speakers::pick_samples(utts, 3, 3.0, 20.0, 8.0);
    let mut cards = Vec::with_capacity(tt.len());
    for (spk, &sec) in &tt {
        let mut smp = Vec::new();
        for (i, u) in samples.get(spk).map(|v| v.as_slice()).unwrap_or(&[]).iter().enumerate() {
            let name = format!("{spk}_{}.wav", i + 1);
            wav::cut(audio, u.start, u.end, &sample_dir.join(&name), 0.2, 12.0)?;
            smp.push(SpeakerSample {
                index: i + 1,
                start: u.start,
                end: u.end,
                text: speakers::excerpt(&u.text, speakers::excerpt_len(lang)),
                audio_path: format!("{prefix}{name}"),
            });
        }
        let hs = hints.get(spk).cloned().unwrap_or_default();
        let mut warnings = Vec::new();
        if sec / total < 0.02 {
            warnings.push("short_talk".to_string());
        }
        let mut distinct: Vec<&str> =
            hs.iter().filter(|h| h.sources.get(speakers::INTRO).is_some_and(|&n| n > 0)).map(|h| h.name.as_str()).collect();
        distinct.sort_unstable();
        distinct.dedup();
        if distinct.len() >= 2 {
            warnings.push("mixed_voices".to_string());
        }
        cards.push(SpeakerCard {
            label: spk.clone(),
            talk_sec: pycompat::round(sec, 2),
            share: pycompat::round(sec / total, 4),
            utterances: counts.get(spk.as_str()).copied().unwrap_or(0),
            first_sec: first.get(spk.as_str()).copied().unwrap_or(0.0),
            hints: hs,
            samples: smp,
            warnings,
        });
    }
    Ok(cards)
}

/// 結果の表示用データ。本文（話者が決まったもの）と確認用（不明）を分け、発言時間は多い順。
pub fn transcript_view(lines: &[Line], tt: &TalkTime, meta: &Meta, duration_sec: f64, named: bool) -> TranscriptView {
    let total = merge::or_one(pycompat::sum(tt.values().copied()));
    let s = |v: &Option<String>| v.clone().unwrap_or_default();
    TranscriptView {
        title: s(&meta.title),
        source: s(&meta.source),
        duration_sec: pycompat::round(duration_sec, 2),
        created_at: s(&meta.created),
        diarizer: s(&meta.diarizer),
        asr: s(&meta.asr),
        named,
        talk_time: tt
            .iter()
            .map(|(k, &v)| TalkTimeItem {
                speaker: k.clone(),
                sec: pycompat::round(v, 2),
                share: pycompat::round(v / total, 4),
            })
            .collect(),
        utterances: lines.iter().filter(|u| u.speaker != UNKNOWN).cloned().collect(),
        unresolved: lines.iter().filter(|u| u.speaker == UNKNOWN).cloned().collect(),
    }
}
