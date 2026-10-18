//! Phase 1 で足した処理のテスト。
//! 3 話者カード・4 whisper.cpp → 語（src/whisper.rs の単体テスト）・5 話者判定 → 区間・6 繰り返し（src/repeat.rs）・7 確認用の手がかり。
//! Python 版との一字一句の一致は、開発用の差分テスト（公開していない）で確かめた。ここはデータの要らない最小の確認。

use kikiwake_core::lang::Lang;
use kikiwake_core::merge::{Turn, Utterance, Word};
use kikiwake_core::{diar, unresolved, view, wav};

fn turn(start: f64, end: f64, speaker: &str) -> Turn {
    Turn { start, end, speaker: speaker.into() }
}

fn utt(start: f64, end: f64, speaker: &str, text: &str) -> Utterance {
    Utterance { start, end, speaker: speaker.into(), text: text.into(), overlap: false }
}

/// 1文字＝1語で、t0 から step 秒ずつ（時刻は Phase 0 の語と同じく小数3桁に丸める）
fn say(words: &mut Vec<Word>, text: &str, t0: f64, step: f64) {
    for (i, ch) in text.chars().enumerate() {
        let r = |x: f64| (x * 1000.0).round() / 1000.0;
        words.push(Word { start: r(t0 + i as f64 * step), end: r(t0 + (i + 1) as f64 * step), word: ch.to_string() });
    }
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("kikiwake-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

// ---- §0-5 話者判定 → 区間 ----

#[test]
fn diar_to_turns_sorts_and_labels() {
    // nemo-speech は話者ごとに並べて返す。始まり（同じなら終わり）の順に直し、ラベルは speaker_<番号>
    let js = r#"{"file": "a.wav", "segments": [
        {"start": 5.0, "end": 6.0, "speaker": 1},
        {"start": 1.0, "end": 2.5, "speaker": 0},
        {"start": 1.0, "end": 2.0, "speaker": 2}]}"#;
    let got = diar::to_turns(js).unwrap();
    assert_eq!(got, [turn(1.0, 2.0, "speaker_2"), turn(1.0, 2.5, "speaker_0"), turn(5.0, 6.0, "speaker_1")]);
}

// ---- §0-3 話者カード ----

#[test]
fn speaker_cards_warnings_and_samples() {
    let d = temp_dir("cards");
    let audio = d.join("a.wav");
    wav::write(&audio, 1, 2, 16000, &vec![0u8; 2 * 16000 * 120]).unwrap();
    let turns = [turn(0.0, 100.0, "speaker_0"), turn(100.0, 101.0, "speaker_1")];
    let utts = [
        utt(1.0, 9.0, "話者A", "PMの松本です。よろしくお願いします。"),
        utt(20.0, 28.0, "話者A", "私山田と申します"), // 手がかりの名前が2種類 → mixed_voices
        utt(100.2, 100.9, "話者B", "はい"),          // 発言時間 1/101 < 2% → short_talk
    ];
    let cards = view::speaker_cards(&utts, &turns, &audio, &d, "samples/", Lang::Ja).unwrap();
    assert_eq!(cards.len(), 2);
    let (a, b) = (&cards[0], &cards[1]);
    assert_eq!((a.label.as_str(), a.talk_sec, a.share, a.utterances, a.first_sec), ("話者A", 100.0, 0.9901, 2, 1.0));
    assert_eq!(a.warnings, ["mixed_voices"]);
    assert_eq!(a.hints.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(), ["松本", "山田"]);
    assert_eq!(a.samples.iter().map(|s| s.audio_path.as_str()).collect::<Vec<_>>(), ["samples/話者A_1.wav", "samples/話者A_2.wav"]);
    assert_eq!((b.label.as_str(), b.share, b.warnings.clone()), ("話者B", 0.0099, vec!["short_talk".to_string()]));
    assert_eq!(b.samples.len(), 1); // 条件（3〜20 秒）に合う発話が無いので長い順に拾う
    assert!(d.join("話者A_2.wav").is_file() && d.join("話者B_1.wav").is_file());
    std::fs::remove_dir_all(&d).unwrap();
}

// ---- §0-7 確認用の名前の手がかり ----

#[test]
fn unresolved_hints_like_the_synthetic_meeting() {
    // 合成会議と同じ形: 序盤の自己紹介（田中・鈴木）が「誰の声か決めきれない」として確認用に回る。直前に「田中さん」と呼ばれている
    let mut words = Vec::new();
    say(&mut words, "では田中さん", 1.0, 0.5);
    say(&mut words, "の田中ですよろしくお願いしますデザイナーの鈴木です", 7.0, 0.3); // 話者区間から 1 秒以上離れている → 確認用
    say(&mut words, "はい", 16.5, 0.5);
    let turns = [turn(0.0, 5.0, "speaker_0"), turn(16.0, 20.0, "speaker_1")];
    let hints = unresolved::unresolved_hints(&words, &turns, None, None, "samples/", Lang::Ja).unwrap();
    assert_eq!(hints.len(), 2);

    let tanaka = &hints[0];
    let src: Vec<(&str, i64)> = tanaka.sources.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    assert_eq!((tanaka.name.as_str(), src), ("田中", vec![("自己紹介", 2), ("呼びかけ直後", 1)]));
    // 名乗った位置が確認用の部分の頭（の1秒前が部分より前）なので、部分の頭から
    let c = &tanaka.clips[0];
    assert_eq!((c.start, c.end, c.text.as_str(), c.audio_path.as_str()),
               (7.0, 14.5, "の田中ですよろしくお願いしますデザイナーの鈴木です", "samples/確認用_1.wav"));

    let suzuki = &hints[1];
    assert_eq!((suzuki.name.as_str(), suzuki.sources.get("自己紹介").copied()), ("鈴木", Some(1)));
    // 「鈴」の語は 13.3 秒 → その 1 秒前（12.3 秒）から。文字も同じ位置（12.3 秒以降の最初の語「ナ」）から
    let c = &suzuki.clips[0];
    assert_eq!((c.start, c.end, c.text.as_str(), c.audio_path.as_str()), (12.3, 14.5, "…ナーの鈴木です", "samples/確認用_2.wav"));
}
