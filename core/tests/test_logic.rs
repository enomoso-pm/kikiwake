//! 移植元 `tests/test_logic.py` の 17 件（純ロジックのテスト）。名前・入力・期待値は Python 版と同じ。

use kikiwake_core::merge::{
    AssignedWord, Names, Turn, UNKNOWN, Utterance, Word, assign_speakers, build_transcript, fmt_ts, group_utterances,
    label_map, talk_time,
};
use kikiwake_core::diar::parse_nemo_segment;
use kikiwake_core::speakers::{name_hints, pick_samples};
use kikiwake_core::wav;

fn w(start: f64, end: f64, word: &str) -> Word {
    Word { start, end, word: word.into() }
}

fn t(start: f64, end: f64, speaker: &str) -> Turn {
    Turn { start, end, speaker: speaker.into() }
}

fn names(pairs: &[(&str, &str)]) -> Names {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

fn speakers(out: &[AssignedWord]) -> Vec<&str> {
    out.iter().map(|w| w.speaker.as_str()).collect()
}

fn pairs(utts: &[Utterance]) -> Vec<(&str, &str)> {
    utts.iter().map(|u| (u.speaker.as_str(), u.text.as_str())).collect()
}

// ---- TestAssign ----

#[test]
fn assign_first_word_with_early_start_goes_to_new_speaker() {
    // 実データの形: 次の話者の最初の語「いい」が無音と前の話者にはみ出している
    let turns = [t(73.84, 76.57, "speaker_2"), t(77.02, 82.16, "speaker_0")];
    let words = [w(76.08, 76.40, "ります"), w(76.40, 77.12, "いい"), w(77.12, 77.50, "ですね")];
    assert_eq!(speakers(&assign_speakers(&words, &turns, 1.0, 0.3)), ["speaker_2", "speaker_0", "speaker_0"]);
}

#[test]
fn assign_gap_fallback_and_unknown() {
    let turns = [t(0.0, 2.0, "a"), t(10.0, 12.0, "b")];
    let words = [w(2.2, 2.5, "近い"), w(5.0, 5.5, "遠い")];
    assert_eq!(speakers(&assign_speakers(&words, &turns, 1.0, 0.3)), ["a", UNKNOWN]);
}

#[test]
fn assign_overlap_flag() {
    let turns = [t(0.0, 5.0, "a"), t(1.0, 5.0, "b")];
    let out = assign_speakers(&[w(2.0, 2.3, "声")], &turns, 1.0, 0.3);
    assert!(out[0].overlap);
}

#[test]
fn assign_zero_length_word() {
    let out = assign_speakers(&[w(1.0, 1.0, "。")], &[t(0.0, 2.0, "a")], 1.0, 0.3);
    assert_eq!(out[0].speaker, "a");
}

#[test]
fn assign_unsorted_turns() {
    let turns = [t(5.0, 6.0, "b"), t(0.0, 1.0, "a")]; // NeMo は話者ごとに並ぶ
    let out = assign_speakers(&[w(0.2, 0.5, "x"), w(5.2, 5.5, "y")], &turns, 1.0, 0.3);
    assert_eq!(speakers(&out), ["a", "b"]);
}

// ---- TestGroup ----

#[test]
fn group_labels_follow_arrival_order() {
    let lm = label_map(&[t(5.0, 6.0, "speaker_1"), t(0.0, 1.0, "speaker_0"), t(7.0, 8.0, "speaker_2")]);
    assert_eq!(lm, names(&[("speaker_0", "話者A"), ("speaker_1", "話者B"), ("speaker_2", "話者C")]));
}

#[test]
fn group_japanese_fragments_become_one_utterance() {
    let turns = [t(0.0, 3.0, "s0"), t(3.5, 6.0, "s1")];
    let words = [w(0.1, 0.3, "ク"), w(0.3, 0.5, "ラ"), w(0.5, 0.7, "ス"), w(0.7, 1.0, "です。"), w(3.6, 4.0, "はい。")];
    let utts = build_transcript(&words, &turns, None, 1.0, 1.5);
    assert_eq!(pairs(&utts), [("話者A", "クラスです。"), ("話者B", "はい。")]);
}

#[test]
fn group_names_merge_split_person() {
    // 同じ人が2ラベルに割れた → 同じ名前を付けると1発話にまとまる
    let turns = [t(0.0, 1.0, "speaker_0"), t(1.2, 2.0, "speaker_1")];
    let words = [w(0.1, 0.9, "前半"), w(1.3, 1.9, "後半")];
    let n = names(&[("話者A", "松本"), ("speaker_1", "松本")]);
    let utts = build_transcript(&words, &turns, Some(&n), 1.0, 1.5);
    assert_eq!(pairs(&utts), [("松本", "前半後半")]);
}

#[test]
fn group_long_monologue_is_split_at_sentence_end() {
    let aw: Vec<AssignedWord> = (0..200)
        .map(|i| AssignedWord {
            start: i as f64,
            end: i as f64 + 0.9,
            word: if i % 10 == 9 { "話。" } else { "話" }.into(),
            speaker: "a".into(),
            overlap: false,
        })
        .collect();
    let utts = group_utterances(&aw, &Names::new(), 1.5, 90.0);
    assert!(utts.len() > 1);
    assert!(utts[..utts.len() - 1].iter().all(|u| u.text.ends_with('。')));
}

#[test]
fn group_hallucination_phrase_is_quarantined_but_real_speech_stays() {
    // 実録画で起きた形: 本物の発言の直後に誤認識文が同じ話者の区間内に出る
    let turns = [t(0.0, 10.0, "speaker_0")];
    let words = [
        w(1.0, 1.5, "思って"),
        w(1.5, 2.0, "ます。"),
        w(2.1, 2.3, "ご"),
        w(2.3, 2.5, "視"),
        w(2.5, 2.7, "聴"),
        w(2.7, 3.5, "ありがとうございました。"),
    ];
    let utts = build_transcript(&words, &turns, None, 1.0, 1.5);
    assert_eq!(pairs(&utts), [("話者A", "思ってます。"), (UNKNOWN, "ご視聴ありがとうございました。")]);
}

#[test]
fn group_talk_time_with_names() {
    let turns = [t(0.0, 10.0, "s0"), t(10.0, 13.0, "s1"), t(13.0, 15.0, "s2")];
    let tt = talk_time(&turns, Some(&names(&[("話者C", "松本"), ("話者A", "松本")])));
    let got: Vec<(&str, f64)> = tt.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    assert_eq!(got, [("松本", 12.0), ("話者B", 3.0)]);
}

#[test]
fn group_fmt_ts() {
    assert_eq!(fmt_ts(3725.2, true), "1:02:05");
    assert_eq!(fmt_ts(125.9, false), "02:05");
}

// ---- TestSpeakers ----

fn u(start: f64, end: f64, speaker: &str, text: &str) -> Utterance {
    Utterance { start, end, speaker: speaker.into(), text: text.into(), overlap: false }
}

#[test]
fn speakers_name_hints() {
    let utts = [
        u(1.0, 5.0, "話者A", "PMの松本です。今日はよろしくお願いします。"),
        u(6.0, 9.0, "話者B", "エンジニアの田中です。よろしくお願いします。"),
        u(700.0, 705.0, "話者A", "では、田中さん。"),
        u(706.0, 710.0, "話者B", "はい、説明します。"),
        u(711.0, 715.0, "話者A", "今日の議題です。"),
    ];
    let h = name_hints(&utts, 600.0);
    assert_eq!(h["話者A"][0].name, "松本");
    let b = &h["話者B"][0];
    let sources: Vec<(&str, i64)> = b.sources.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    assert_eq!((b.name.as_str(), sources), ("田中", vec![("自己紹介", 2), ("呼びかけ直後", 1)]));
    assert!(!h["話者A"].iter().any(|x| x.name == "議題")); // 冒頭以外の「の〇〇です」は拾わない
}

#[test]
fn speakers_name_hints_moushimashite_without_punctuation() {
    // 実録音で取りこぼした形（句読点なしの「私〇〇と申しまして」）を架空の名前で再現
    let utts = [u(150.0, 170.0, "話者A", "ちょっと自己紹介させてくださいはい私山田と申しまして今の会社は2社目です")];
    assert_eq!(name_hints(&utts, 600.0)["話者A"][0].name, "山田");
}

#[test]
fn speakers_pick_samples_spread_and_skip_overlap() {
    let utts: Vec<Utterance> = (0..9)
        .map(|i| Utterance {
            start: i as f64 * 20.0,
            end: i as f64 * 20.0 + 8.0,
            speaker: "話者A".into(),
            text: format!("発話{i}"),
            overlap: i == 0,
        })
        .collect();
    let picked = &pick_samples(&utts, 3, 3.0, 20.0, 8.0)["話者A"];
    assert_eq!(picked.len(), 3);
    assert!(!picked.iter().any(|u| u.overlap));
    assert!(picked[0].start < picked[1].start);
    assert!(picked[1].start < picked[2].start);
}

#[test]
fn speakers_cut_wav() {
    let d = std::env::temp_dir().join(format!("kikiwake-test-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    let (src, dst) = (d.join("a.wav"), d.join("b.wav"));
    wav::write(&src, 1, 2, 16000, &vec![0u8; 2 * 16000 * 30]).unwrap();
    wav::cut(&src, 5.0, 25.0, &dst, 0.0, 12.0).unwrap();
    let info = wav::read_info(&mut std::fs::File::open(&dst).unwrap()).unwrap();
    assert!((info.nframes as f64 / info.rate as f64 - 12.0).abs() < 0.005);
    std::fs::remove_dir_all(&d).unwrap();
}

// ---- TestDiarizeParse ----

#[test]
fn diarize_parse_space_and_comma() {
    assert_eq!(parse_nemo_segment("1.470 4.890 speaker_0").unwrap(), t(1.47, 4.89, "speaker_0"));
    assert_eq!(parse_nemo_segment("0.51, 12.62, 1").unwrap(), t(0.51, 12.62, "speaker_1"));
}
