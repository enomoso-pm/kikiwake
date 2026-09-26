//! 同じ文の繰り返しの検出（安全網）。
//!
//! whisper.cpp は文脈を引き継ぐ設定だと、実録音 68 分の 16.7 分から最後まで同じ文（15 文字）を 1,480 回（2 秒おき）
//! 繰り返して壊れた。採用した設定（文脈を引き継がない `-mc 0`）では起きなかったが、見つけられるようにしておく。
//! Phase 1 は「見つけて範囲を返す」まで。見つけたときにどうするか（やり直す・知らせる）は Phase 2 で決める。
//!
//! 目印は2つ（どちらも Phase 0 と Phase 1 の実測で閾値を決めた）:
//!   1. 同じ区切りの文が続いた回数: 20 回以上。正常な出力の最長は 6 回（会話後の無音の誤認識が 4 秒おき）、壊れた出力は 1,480 回。
//!      間隔では分けられない（正常な 6 回も 4 秒おきで、壊れた出力の 2 秒おきと近い）
//!   2. 5 分ごとの繰り返し度（12 文字の並びの重なり。200 字を超える窓だけ）: 60% 以上。正常は最大 24%（会話後の無音）、壊れた出力は 99%。
//!      同じ文でなくても、2つの文を交互に繰り返すような壊れ方を拾う
//! 長い休憩の無音で誤認識が続いた場合も繰り返しとして返す。人が話していた部分を上書きしたか（壊れた出力）、
//! 無音の部分か（害は小さい。確認用に隔離される）は `speech_seconds` で話者区間と重ねて見分ける。

use std::collections::HashSet;

use serde::Serialize;

use crate::merge::Turn;
use crate::whisper::Segment;
use crate::pycompat;

/// 検出の閾値
#[derive(Clone, Debug)]
pub struct RepeatConfig {
    /// 同じ文がこの回数以上続いたら繰り返しとみなす
    pub min_run: usize,
    /// 繰り返し度を測る窓の長さ（秒）
    pub window_sec: f64,
    /// 繰り返し度を測る文字の並びの長さ
    pub ngram: usize,
    /// この字数を超える窓だけ測る（短い窓は重なりの割合が振れる）
    pub min_chars: usize,
    /// 繰り返し度がこれ以上なら繰り返しとみなす
    pub max_rate: f64,
}

impl Default for RepeatConfig {
    fn default() -> Self {
        Self { min_run: 20, window_sec: 300.0, ngram: 12, min_chars: 200, max_rate: 0.6 }
    }
}

/// 見つけた繰り返し
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Repeat {
    /// 同じ区切りの文が続いた（start は最初の区切りの始まり、end は最後の区切りの終わり）
    SameText { start: f64, end: f64, text: String, count: usize },
    /// 5 分ごとの窓の繰り返し度が高い（start / end は窓の範囲）
    Window { start: f64, end: f64, rate: f64, chars: usize },
}

impl Repeat {
    pub fn range(&self) -> (f64, f64) {
        match self {
            Repeat::SameText { start, end, .. } | Repeat::Window { start, end, .. } => (*start, *end),
        }
    }
}

struct Run {
    text: String,
    start: f64,
    end: f64,
    count: usize,
}

/// 区切りを時刻順に1つずつ渡して繰り返しを見つける（Phase 2 で書き起こしの途中から使えるように）。
pub struct RepeatDetector {
    cfg: RepeatConfig,
    run: Option<Run>,
    window: Option<(i64, String)>,
    found: Vec<Repeat>,
}

/// 繰り返し度を測るときに除く文字（空白と句読点・記号。長音「ー」も除く）
fn keep(c: char) -> bool {
    !(pycompat::is_space(c) || "、。，．,.!?！？・「」『』（）()…ー-".contains(c))
}

/// 12 文字の並びの重なりの割合（1 − 異なる並びの数 ÷ 並びの数）
pub fn repeat_rate(text: &str, n: usize) -> f64 {
    let chars: Vec<char> = text.chars().filter(|&c| keep(c)).collect();
    if chars.len() <= n {
        return 0.0;
    }
    let grams: Vec<&[char]> = chars.windows(n).take(chars.len() - n).collect();
    let distinct: HashSet<&[char]> = grams.iter().copied().collect();
    1.0 - distinct.len() as f64 / grams.len() as f64
}

impl RepeatDetector {
    pub fn new(cfg: RepeatConfig) -> Self {
        Self { cfg, run: None, window: None, found: Vec::new() }
    }

    /// 区切りを1つ足す。繰り返しを新しく見つけたら、その時点の範囲で返す（同じ繰り返しが続く間は最初の1回だけ）。
    pub fn push(&mut self, start: f64, end: f64, text: &str) -> Option<Repeat> {
        let mut alert = None;
        let t = pycompat::strip(text);
        if !t.is_empty() {
            match &mut self.run {
                Some(r) if r.text == t => {
                    r.count += 1;
                    r.end = end;
                    if r.count == self.cfg.min_run {
                        alert = Some(Repeat::SameText { start: r.start, end: r.end, text: r.text.clone(), count: r.count });
                    }
                }
                _ => {
                    self.close_run();
                    self.run = Some(Run { text: t.to_string(), start, end, count: 1 });
                }
            }
        }
        // 窓は区切りの真ん中の時刻で決める（Phase 0 の測り方と同じ）
        let w = ((start + end) / 2.0 / self.cfg.window_sec).floor() as i64;
        match &mut self.window {
            Some((cur, buf)) if *cur == w => buf.push_str(text),
            _ => {
                if let Some(found) = self.close_window() {
                    alert = alert.or(Some(found));
                }
                self.window = Some((w, text.to_string()));
            }
        }
        alert
    }

    fn close_run(&mut self) {
        if let Some(r) = self.run.take()
            && r.count >= self.cfg.min_run
        {
            self.found.push(Repeat::SameText { start: r.start, end: r.end, text: r.text, count: r.count });
        }
    }

    fn close_window(&mut self) -> Option<Repeat> {
        let (w, buf) = self.window.take()?;
        let chars = buf.chars().filter(|&c| keep(c)).count();
        if chars <= self.cfg.min_chars {
            return None;
        }
        let rate = repeat_rate(&buf, self.cfg.ngram);
        if rate < self.cfg.max_rate {
            return None;
        }
        let start = w as f64 * self.cfg.window_sec;
        let found = Repeat::Window { start, end: start + self.cfg.window_sec, rate: pycompat::round(rate, 3), chars };
        self.found.push(found.clone());
        Some(found)
    }

    /// 最後まで足したあとの、見つけた繰り返しの一覧（時刻順。同じ文の繰り返しは最終の回数と範囲）。
    pub fn finish(mut self) -> Vec<Repeat> {
        self.close_run();
        self.close_window();
        self.found.sort_by(|a, b| crate::merge::cmp_f64(a.range().0, b.range().0));
        self.found
    }
}

/// whisper-cli の区切りの並びから繰り返しを見つける（既定の閾値）。
pub fn find_repeats(segments: &[Segment]) -> Vec<Repeat> {
    let mut d = RepeatDetector::new(RepeatConfig::default());
    for s in segments {
        d.push(s.offsets.from as f64 / 1000.0, s.offsets.to as f64 / 1000.0, &s.text);
    }
    d.finish()
}

/// 範囲のうち、誰かが話していた秒数（話者区間の和集合と重なる長さ）。
/// 大きければ人の発言を上書きした壊れ方、ほぼ 0 なら無音の部分の誤認識（確認用に隔離されるので害は小さい）。
pub fn speech_seconds(start: f64, end: f64, turns: &[Turn]) -> f64 {
    let mut spans: Vec<(f64, f64)> = turns
        .iter()
        .map(|t| (t.start.max(start), t.end.min(end)))
        .filter(|(a, b)| b > a)
        .collect();
    spans.sort_by(|a, b| crate::merge::cmp_f64(a.0, b.0));
    let mut total = 0.0;
    let mut cur: Option<(f64, f64)> = None;
    for (a, b) in spans {
        match cur {
            Some((ca, cb)) if a <= cb => cur = Some((ca, cb.max(b))),
            Some((ca, cb)) => {
                total += cb - ca;
                cur = Some((a, b));
            }
            None => cur = Some((a, b)),
        }
    }
    if let Some((a, b)) = cur {
        total += b - a;
    }
    total
}

/// 見つけた繰り返しの説明（報告用。録音の中身を出さないよう、文そのものは書かず字数だけ）
pub fn describe(r: &Repeat) -> String {
    let (s, e) = r.range();
    let span = format!("{}〜{}", crate::merge::fmt_ts(s, true), crate::merge::fmt_ts(e, true));
    match r {
        Repeat::SameText { text, count, .. } => format!("同じ文（{}字）が {count} 回（{span}）", pycompat::char_len(text)),
        Repeat::Window { rate, chars, .. } => format!("繰り返し度 {:.0}%（{span}・{chars}字）", rate * 100.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(items: &[(f64, f64, &str)]) -> (Vec<Repeat>, Vec<Repeat>) {
        let mut d = RepeatDetector::new(RepeatConfig::default());
        let alerts: Vec<Repeat> = items.iter().filter_map(|(s, e, t)| d.push(*s, *e, t)).collect();
        (alerts, d.finish())
    }

    fn normal_talk(from: f64, to: f64) -> Vec<(f64, f64, String)> {
        // 毎回違う文（正常な会話の代わり。文字を擬似乱数で並べる）
        let pool: Vec<char> = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわを会議資料確認予定開発画面設計".chars().collect();
        let mut seed: u64 = 12345;
        let mut v = Vec::new();
        let mut t = from;
        while t < to {
            let line: String = (0..24)
                .map(|_| {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    pool[(seed >> 33) as usize % pool.len()]
                })
                .collect();
            v.push((t, t + 4.0, line));
            t += 4.5;
        }
        v
    }

    #[test]
    fn broken_output_like_phase0_is_found_with_its_range() {
        // 実録音で起きた形: 16.7 分から同じ 15 文字の文が 2 秒おきに 1,480 回
        let mut items = normal_talk(0.0, 1002.0);
        for i in 0..1480 {
            let s = 1002.0 + i as f64 * 2.0;
            items.push((s, s + 2.0, "同じ文を繰り返してしまっています。".to_string()));
        }
        let refs: Vec<(f64, f64, &str)> = items.iter().map(|(s, e, t)| (*s, *e, t.as_str())).collect();
        let (alerts, found) = feed(&refs);
        let same: Vec<&Repeat> = found.iter().filter(|r| matches!(r, Repeat::SameText { .. })).collect();
        assert_eq!(same.len(), 1);
        assert_eq!(same[0], &Repeat::SameText { start: 1002.0, end: 1002.0 + 1480.0 * 2.0, text: "同じ文を繰り返してしまっています。".into(), count: 1480 });
        assert!(found.iter().any(|r| matches!(r, Repeat::Window { rate, .. } if *rate > 0.9)));
        // 途中で知らせるのは、20 回目に1度だけ（同じ文の繰り返しとして）
        let first = alerts.iter().find(|r| matches!(r, Repeat::SameText { .. })).unwrap();
        assert_eq!(first, &Repeat::SameText { start: 1002.0, end: 1002.0 + 20.0 * 2.0, text: "同じ文を繰り返してしまっています。".into(), count: 20 });
        assert_eq!(alerts.iter().filter(|r| matches!(r, Repeat::SameText { .. })).count(), 1);
    }

    #[test]
    fn normal_silence_hallucination_is_not_found() {
        // 正常な出力の最長（会話後の無音に同じ誤認識が 4 秒おきに 6 回）
        let mut items = normal_talk(0.0, 600.0);
        for i in 0..6 {
            let s = 600.0 + i as f64 * 4.0;
            items.push((s, s + 3.0, "ありがとうございました。".to_string()));
        }
        let refs: Vec<(f64, f64, &str)> = items.iter().map(|(s, e, t)| (*s, *e, t.as_str())).collect();
        assert_eq!(feed(&refs).1, vec![]);
    }

    #[test]
    fn alternating_loop_is_found_by_window_rate() {
        // 2つの文を交互に繰り返す壊れ方（同じ文が続かないので 1 では拾えない）
        let items: Vec<(f64, f64, &str)> = (0..300)
            .map(|i| (i as f64 * 2.0, i as f64 * 2.0 + 2.0, if i % 2 == 0 { "予定を確認します。" } else { "資料を送ります。" }))
            .collect();
        let found = feed(&items).1;
        assert!(!found.is_empty() && found.iter().all(|r| matches!(r, Repeat::Window { .. })));
    }

    #[test]
    fn speech_seconds_merges_overlapping_turns() {
        let t = |s: f64, e: f64| Turn { start: s, end: e, speaker: "x".into() };
        let turns = [t(0.0, 10.0), t(5.0, 20.0), t(30.0, 40.0)];
        assert_eq!(speech_seconds(8.0, 35.0, &turns), 12.0 + 5.0);
        assert_eq!(speech_seconds(50.0, 60.0, &turns), 0.0);
    }
}
