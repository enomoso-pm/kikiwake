//! 受け渡しの約束 版7: 英語の画面で保存するファイル（見出し・確認用の欄・「話者A」「不明」を英語に）。
//! 日本語の保存は Python 版と一字一句同じまま（test_v3.rs と開発用の差分テストで確かめる）。

use kikiwake_core::lang::Lang;
use kikiwake_core::lines::{self, LineEdits, SaveFormat};
use kikiwake_core::merge::{Meta, Names, Turn, Word};

fn say(words: &mut Vec<Word>, text: &str, t0: f64, step: f64) {
    for (i, ch) in text.chars().enumerate() {
        let r = |x: f64| (x * 1000.0).round() / 1000.0;
        words.push(Word { start: r(t0 + i as f64 * step), end: r(t0 + (i + 1) as f64 * step), word: ch.to_string() });
    }
}

fn turn(start: f64, end: f64, speaker: &str) -> Turn {
    Turn { start, end, speaker: speaker.into() }
}

/// 話者A（0〜4秒）→ 話者B（4.5〜8秒）→ 確認用（10.5秒〜）→ 話者A（14〜18秒。B と声が重なる）
fn meeting() -> (Vec<Word>, Vec<Turn>) {
    let mut w = Vec::new();
    say(&mut w, "では始めます", 0.5, 0.5);
    say(&mut w, "議題は二つです", 4.6, 0.4);
    say(&mut w, "田中ですよろしく", 10.5, 0.3);
    say(&mut w, "ありがとうございます", 14.2, 0.3);
    let turns = vec![turn(0.0, 4.0, "speaker_0"), turn(4.5, 8.0, "speaker_1"), turn(14.0, 18.0, "speaker_0"), turn(14.0, 18.0, "speaker_1")];
    (w, turns)
}

fn meta() -> Meta {
    Meta {
        title: Some("定例".into()),
        source: Some("/Users/example/定例.m4a".into()),
        duration: Some(20.0),
        diarizer: Some("Nemotron 3 Diarization".into()),
        asr: Some("Whisper large-v3（whisper.cpp）".into()),
        created: Some("2026-09-27".into()),
        audio: None,
    }
}

fn get<'a>(files: &'a [(String, String)], name: &str) -> &'a str {
    &files.iter().find(|(f, _)| f == name).unwrap_or_else(|| panic!("{name} が無い")).1
}

#[test]
fn english_labels_and_sections() {
    let (w, t) = meeting();
    let all = [SaveFormat::Md, SaveFormat::Txt, SaveFormat::Json];
    let files = lines::save_files(&w, &t, None, &LineEdits::default(), &meta(), &all, Lang::En);
    // ファイル名は日本語と同じ
    assert_eq!(files.iter().map(|(f, _)| f.as_str()).collect::<Vec<_>>(), ["transcript.md", "transcript.txt", "transcript.json"]);
    assert_eq!(
        get(&files, "transcript.md"),
        "# Speaker-labeled transcript: 定例\n\
         \n\
         - Source file: /Users/example/定例.m4a\n\
         - Length: 00:20 / Speakers: 2 — Speaker A 00:08 (52%), Speaker B 00:07 (48%)\n\
         - Processing: speaker detection by Nemotron 3 Diarization / transcription by Whisper large-v3 (whisper.cpp) / 2026-09-27\n\
         - Speakers were identified automatically from their voices. `*` marks lines where someone else was speaking at the same time\n\
         \n\
         [00:00] Speaker A: では始めます\n\
         [00:04] Speaker B: 議題は二つです\n\
         [00:14] Speaker A*: ありがとうございます\n\
         \n\
         ---\n\
         \n\
         ## Unassigned: parts without a speaker\n\
         \n\
         Text transcribed where no one's voice was detected. It's often silence misheard as speech, \
         but speaker detection may also have missed someone, so check the original recording if needed.\n\
         \n\
         [00:10] 田中ですよろしく\n"
    );
    assert_eq!(
        get(&files, "transcript.txt"),
        "[00:00] Speaker A: では始めます\n[00:04] Speaker B: 議題は二つです\n[00:14] Speaker A*: ありがとうございます\n\
         \nUnassigned (parts without a speaker)\n[00:10] 田中ですよろしく\n"
    );
    let json: Vec<serde_json::Value> = serde_json::from_str(get(&files, "transcript.json")).unwrap();
    let who: Vec<&str> = json.iter().map(|u| u["speaker"].as_str().unwrap()).collect();
    assert_eq!(who, ["Speaker A", "Speaker B", "Unknown", "Speaker A"]);
}

#[test]
fn english_keeps_names_and_edits() {
    let (w, t) = meeting();
    let n: Names = [("話者A", "佐藤")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let edits = LineEdits {
        names: [("u2", "田中")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        confirmed: vec!["u2".into()],
        ..LineEdits::default()
    };
    let ja = lines::save_files(&w, &t, Some(&n), &edits, &meta(), &[SaveFormat::Txt], Lang::Ja);
    let en = lines::save_files(&w, &t, Some(&n), &edits, &meta(), &[SaveFormat::Txt], Lang::En);
    assert_eq!(ja[0].0, "transcript_named.txt");
    assert_eq!(en[0].0, "transcript_named.txt");
    // 付けた名前はそのまま、名前の無いラベルだけ英語に。確定した確認用の行は本文に入る（日本語と同じ中身）
    assert_eq!(ja[0].1, "[00:00] 佐藤: では始めます\n[00:04] 話者B: 議題は二つです\n[00:10] 田中: 田中ですよろしく\n[00:14] 佐藤*: ありがとうございます\n");
    assert_eq!(en[0].1, ja[0].1.replace("話者B", "Speaker B"));
}
