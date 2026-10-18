//! 受け渡しの約束 版3（UI 側の依頼 R2〜R6）: 結果の画面の行と、手直しを当てた保存。
//! Python の参照実装との一字一句の一致は、開発用の差分テスト（公開していない）で確かめた。

use kikiwake_core::lang::Lang;
use kikiwake_core::lines::{self, LineEdits, SaveFormat};
use kikiwake_core::merge::{Meta, Names, Turn, UNKNOWN, Word};

fn say(words: &mut Vec<Word>, text: &str, t0: f64, step: f64) {
    for (i, ch) in text.chars().enumerate() {
        let r = |x: f64| (x * 1000.0).round() / 1000.0;
        words.push(Word { start: r(t0 + i as f64 * step), end: r(t0 + (i + 1) as f64 * step), word: ch.to_string() });
    }
}

fn turn(start: f64, end: f64, speaker: &str) -> Turn {
    Turn { start, end, speaker: speaker.into() }
}

fn names(pairs: &[(&str, &str)]) -> Names {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

/// 話者A（0〜4秒）→ 話者B（4.5〜8秒・A と同じ人が割れたラベル）→ 確認用（10.5秒〜）→ 話者A（14〜18秒）
fn meeting() -> (Vec<Word>, Vec<Turn>) {
    let mut w = Vec::new();
    say(&mut w, "では始めます", 0.5, 0.5);
    say(&mut w, "議題は二つです", 4.6, 0.4);
    say(&mut w, "田中ですよろしく", 10.5, 0.3);
    say(&mut w, "ありがとうございます", 14.2, 0.3);
    (w, vec![turn(0.0, 4.0, "speaker_0"), turn(4.5, 8.0, "speaker_1"), turn(14.0, 18.0, "speaker_0")])
}

#[test]
fn line_ids_and_boundaries_do_not_change_with_names() {
    let (w, t) = meeting();
    let plain = lines::lines(&w, &t, None, Lang::Ja);
    // 話者A と話者B に同じ名前を付けても、画面の行はまとめない（id も区切りも同じ）
    let named = lines::lines(&w, &t, Some(&names(&[("話者A", "佐藤"), ("話者B", " 佐藤\u{3000}"), ("話者C", "")])), Lang::Ja);
    let ids = |v: &[lines::LineRow]| v.iter().map(|r| (r.line.id.clone(), r.line.start, r.line.label.clone())).collect::<Vec<_>>();
    assert_eq!(ids(&plain), ids(&named));
    let spk: Vec<&str> = named.iter().map(|r| r.line.speaker.as_str()).collect();
    assert_eq!(spk, ["佐藤", "佐藤", UNKNOWN, "佐藤"]); // 名前の前後の空白（全角も）は除く
}

#[test]
fn save_applies_edits_then_merges_same_names() {
    let (w, t) = meeting();
    let meta = Meta { duration: Some(20.0), ..Meta::default() };
    let n = names(&[("話者A", "佐藤"), ("話者B", "佐藤")]);
    let edits = LineEdits {
        names: names(&[("u2", "田中")]),
        confirmed: vec!["u2".into()],
        texts: names(&[("u1", "議題は\n三つです")]),
    };
    let files = lines::save_files(&w, &t, Some(&n), &edits, &meta, &[SaveFormat::Txt, SaveFormat::Json], Lang::Ja);
    assert_eq!(files.iter().map(|(f, _)| f.as_str()).collect::<Vec<_>>(), ["transcript_named.txt", "transcript_named.json"]);
    // 保存では、同じ名前（佐藤）の隣り合う行が1行に。確定した確認用は本文へ。直した文字は改行を空白にして入る
    assert_eq!(files[0].1, "[00:00] 佐藤: では始めます議題は 三つです\n[00:10] 田中: 田中ですよろしく\n[00:14] 佐藤: ありがとうございます\n");
    // 確定していなければ確認用のまま（.txt の末尾）
    let unconfirmed = LineEdits { names: names(&[("u2", "田中")]), ..LineEdits::default() };
    let files = lines::save_files(&w, &t, Some(&n), &unconfirmed, &meta, &[SaveFormat::Txt], Lang::Ja);
    assert!(files[0].1.ends_with("\n確認用（話者を決められなかった部分）\n[00:10] 田中ですよろしく\n"));
    // 名前が1つも無ければ Python 版と同じく transcript.*
    let files = lines::save_files(&w, &t, None, &LineEdits::default(), &meta, &[SaveFormat::Md], Lang::Ja);
    assert_eq!(files[0].0, "transcript.md");
}

#[test]
fn write_files_asks_before_overwriting() {
    let d = std::env::temp_dir().join(format!("kikiwake-v3-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    let files = vec![("transcript_named.md".to_string(), "新しい".to_string())];
    let first = lines::write_files(&d, &files, false).unwrap();
    assert_eq!((first.files.len(), first.existing.len()), (1, 0));
    // 同じ名前があれば、上書きの指定が無い限り書かずに一覧を返す
    std::fs::write(d.join("transcript_named.md"), "前の").unwrap();
    let again = lines::write_files(&d, &files, false).unwrap();
    assert_eq!((again.files.len(), again.existing.len()), (0, 1));
    assert_eq!(std::fs::read_to_string(d.join("transcript_named.md")).unwrap(), "前の");
    let forced = lines::write_files(&d, &files, true).unwrap();
    assert_eq!(forced.files.len(), 1);
    assert_eq!(std::fs::read_to_string(d.join("transcript_named.md")).unwrap(), "新しい");
    std::fs::remove_dir_all(&d).unwrap();
}
