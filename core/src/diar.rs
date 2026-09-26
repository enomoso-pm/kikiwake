//! 話者判定の出力 → 話者区間。
//!
//! NeMo-Speech.cpp の `nemo-speech diarize --format json` は `{"segments": [{start, end, speaker: 整数}]}` を返す。
//! 話者ごとに並んで出てくるので、始まり（同じなら終わり）の順に並べ直す。ラベルは Python 版と同じ `speaker_<番号>`。

use std::io;

use serde_json::Value;

use crate::merge::{Turn, cmp_f64};
use crate::{patterns, pycompat};

fn bad(msg: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg)
}

/// nemo-speech の JSON → Python 版と同じ turns（diarization.json）。
pub fn to_turns(json: &str) -> io::Result<Vec<Turn>> {
    let doc: Value = serde_json::from_str(json).map_err(|e| bad(e.to_string()))?;
    let segs = doc["segments"].as_array().ok_or_else(|| bad("segments が無い".into()))?;
    let mut turns = Vec::with_capacity(segs.len());
    for s in segs {
        let num = |k: &str| s[k].as_f64().ok_or_else(|| bad(format!("{k} が数でない: {s}")));
        let speaker = match &s["speaker"] {
            Value::Number(n) if n.is_f64() => pycompat::repr(n.as_f64().unwrap()),
            Value::Number(n) => n.to_string(),
            Value::String(t) => t.clone(),
            other => return Err(bad(format!("speaker が読めない: {other}"))),
        };
        turns.push(Turn { start: num("start")?, end: num("end")?, speaker: format!("speaker_{speaker}") });
    }
    turns.sort_by(|a, b| cmp_f64(a.start, b.start).then(cmp_f64(a.end, b.end)));
    Ok(turns)
}

/// NeMo（Python 版）の出力1件 → 区間（移植元 diarize.py の parse_nemo_segment。Python 版のエンジン用だがテストごと残す）。
///
/// 実測では '1.470 4.890 speaker_0'（空白区切り）。モデルカードの表記はカンマ区切りなので両方受け付ける。
/// 話者が数字だけなら `speaker_<数字>` にする（Python の isdigit と違い、数字は半角だけを見る）。
pub fn parse_nemo_segment(seg: &str) -> io::Result<Turn> {
    let parts: Vec<&str> = patterns::NEMO_SPLIT.split(pycompat::strip(seg)).filter(|p| !p.is_empty()).collect();
    if parts.len() < 3 {
        return Err(bad(format!("話者分離の出力を解釈できない: {seg:?}")));
    }
    let num = |p: &str| p.parse::<f64>().map_err(|_| bad(format!("数でない: {p:?}")));
    let digits = !parts[2].is_empty() && parts[2].chars().all(|c| c.is_ascii_digit());
    let speaker = if digits { format!("speaker_{}", parts[2]) } else { parts[2].to_string() };
    Ok(Turn { start: num(parts[0])?, end: num(parts[1])?, speaker })
}
