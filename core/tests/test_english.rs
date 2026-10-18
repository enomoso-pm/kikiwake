//! 英語の録音の書き起こし（2026-10-18。英語の文字起こし 1.2.0）。日本語は今までと同じ結果のまま。
use kikiwake_core::lang::Lang;
use kikiwake_core::lines;
use kikiwake_core::merge::{build_transcript, Turn, UNKNOWN, Word};
use kikiwake_core::speakers::name_hints;

fn w(word: &str, start: f64, end: f64) -> Word {
    Word { start, end, word: word.into() }
}

fn turn(start: f64, end: f64, speaker: &str) -> Turn {
    Turn { start, end, speaker: speaker.into() }
}

/// 話者が替わる境目の語が割れない（" you" が前の人、"'d" が次の人の区間に入っても、"you'd" は次の人の行に）
#[test]
fn english_word_pieces_stay_together() {
    let words = vec![
        w(" Thanks", 0.0, 0.4),
        w(" a", 0.4, 0.5),
        w(" lot.", 0.5, 1.0),
        w(" you", 1.05, 1.15),
        w("'d", 1.3, 1.5),
        w(" be", 1.5, 1.7),
        w(" able", 1.7, 2.0),
        w(" to", 2.0, 2.1),
        w(" share", 2.1, 2.5),
        w(" it.", 2.5, 3.0),
    ];
    let turns = vec![turn(0.0, 1.2, "speaker_0"), turn(1.2, 3.2, "speaker_1")];
    let en = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::En);
    let texts: Vec<(&str, &str)> = en.iter().map(|u| (u.speaker.as_str(), u.text.as_str())).collect();
    assert_eq!(texts, [("話者A", "Thanks a lot."), ("話者B", "you'd be able to share it.")]);
    // 日本語の決まり（部品ごとに話者を決める）は変えない
    let ja = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::Ja);
    assert_eq!(ja[0].text, "Thanks a lot. you");
    assert_eq!(ja[1].text, "'d be able to share it.");
}

/// 無音の所の定番の誤認識文（"Thanks for watching" など）は確認用へ。"Thank you." は会議でも言うので本文に残す
#[test]
fn english_hallucinations() {
    let words = vec![
        w(" Thank", 0.0, 0.3),
        w(" you.", 0.3, 0.8),
        w(" Thanks", 5.0, 5.3),
        w(" for", 5.3, 5.5),
        w(" watching!", 5.5, 6.0),
    ];
    let turns = vec![turn(0.0, 1.0, "speaker_0"), turn(4.9, 6.2, "speaker_0")];
    let utts = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::En);
    assert_eq!(utts[0].speaker, "話者A");
    assert_eq!(utts[0].text, "Thank you.");
    assert_eq!(utts[1].speaker, UNKNOWN);
    assert_eq!(utts[1].text, "Thanks for watching!");
    // 日本語の決まりでは英語の定番の文は見ない
    let ja = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::Ja);
    assert!(ja.iter().all(|u| u.speaker == "話者A"));
}

/// 長い独話（90 秒を超える）は文の終わりで段落を切る。英語は "." でも切る（日本語は「。」「？」「！」と半角の「?」「!」）
#[test]
fn english_long_monologue_splits_at_period() {
    let mut words = Vec::new();
    let mut t = 0.0;
    for i in 0..40 {
        words.push(w(&format!(" Sentence {i} is here."), t, t + 2.5));
        t += 3.0;
    }
    let turns = vec![turn(0.0, t, "speaker_0")];
    let en = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::En);
    assert!(en.len() >= 2, "英語は 90 秒を超えたら '.' で切る");
    assert!(en.iter().all(|u| u.end - u.start <= 95.0));
    let ja = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::Ja);
    assert_eq!(ja.len(), 1, "日本語の決まりでは '.' で切らない（今までどおり）");
}

/// 保存するファイルの行のまとめ方も録音の言語で（meta.json の language）
#[test]
fn english_saved_lines_follow_meta_language() {
    let words = vec![w(" you", 1.05, 1.15), w("'d", 1.3, 1.5), w(" see.", 1.5, 2.0)];
    let turns = vec![turn(0.0, 1.2, "speaker_0"), turn(1.2, 2.2, "speaker_1")];
    let rows = lines::lines(&words, &turns, None, Lang::En);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].line.text, "you'd see.");
    assert_eq!(rows[0].line.label, "話者B");
}

/// 英語の名前の手がかり（話者カード）: 自己紹介と呼びかけ直後
#[test]
fn english_name_hints() {
    let words = vec![
        w(" Hi,", 0.0, 0.3),
        w(" I'm", 0.3, 0.6),
        w(" Matsumoto,", 0.6, 1.2),
        w(" the", 1.2, 1.4),
        w(" project", 1.4, 1.8),
        w(" manager.", 1.8, 2.4),
        w(" Tom,", 2.6, 3.0),
        w(" how", 3.0, 3.2),
        w(" did", 3.2, 3.4),
        w(" the", 3.4, 3.5),
        w(" test", 3.5, 3.8),
        w(" go?", 3.8, 4.2),
        w(" It", 5.0, 5.2),
        w(" went", 5.2, 5.5),
        w(" well.", 5.5, 6.0),
    ];
    let turns = vec![turn(0.0, 4.3, "speaker_0"), turn(4.9, 6.2, "speaker_1")];
    let utts = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::En);
    let hints = name_hints(&utts, 600.0, Lang::En);
    assert_eq!(hints["話者A"][0].name, "Matsumoto");
    assert_eq!(hints["話者A"][0].sources.get("自己紹介"), Some(&1));
    assert_eq!(hints["話者B"][0].name, "Tom");
    assert_eq!(hints["話者B"][0].sources.get("呼びかけ直後"), Some(&1));
    // 日本語の決まりでは英語の名乗りは拾わない
    assert!(name_hints(&utts, 600.0, Lang::Ja).is_empty());
}

/// 3 語以上の同じ文が 3 回以上続いたら、最初の 1 回だけ本文に残し、あとは確認用へ（静かな所の Whisper の繰り返し）。
/// 短いあいづちの繰り返しは本文に残す
#[test]
fn english_repeated_sentences_go_to_unresolved() {
    let mut words = vec![w(" That's", 0.0, 0.3), w(" fine.", 0.3, 0.6)];
    let mut t = 0.6;
    for _ in 0..4 {
        for piece in [" And", " we", " have", " to", " keep", " it", " here."] {
            words.push(w(piece, t, t + 0.1));
            t += 0.1;
        }
    }
    for piece in [" Okay.", " Okay.", " Okay."] {
        words.push(w(piece, t, t + 0.2));
        t += 0.2;
    }
    let turns = vec![turn(0.0, t + 0.1, "speaker_0")];
    let utts = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::En);
    let main: String = utts.iter().filter(|u| u.speaker != UNKNOWN).map(|u| u.text.clone()).collect::<Vec<_>>().join(" | ");
    let unknown: String = utts.iter().filter(|u| u.speaker == UNKNOWN).map(|u| u.text.clone()).collect::<Vec<_>>().join(" | ");
    assert_eq!(main.matches("And we have to keep it here.").count(), 1, "{main}");
    assert_eq!(unknown.matches("And we have to keep it here.").count(), 3, "{unknown}");
    assert!(main.contains("Okay. Okay. Okay."), "{main}");
    // 日本語の決まりは今までどおり（繰り返しても本文に残す）
    let ja = build_transcript(&words, &turns, None, 1.0, 1.5, Lang::Ja);
    assert!(ja.iter().all(|u| u.speaker != UNKNOWN));
}
