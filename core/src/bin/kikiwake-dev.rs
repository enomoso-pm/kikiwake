//! 差分テスト用の小さなコマンド（アプリには入らない）。Python 版との突き合わせ（開発用のツール。公開していない）から呼ぶ。
//!
//!     kikiwake-dev pycompat <in.json> <out.json>     Python 互換の部品を、Python が作った入力で動かす
//!     kikiwake-dev json-roundtrip <file.json>…       Python が書いた JSON を読んで書き直し、同じバイト列か確かめる
//!     kikiwake-dev merge <dir>…                       merge.write_outputs（dir に names.json があれば実名版も）
//!     kikiwake-dev speakers <dir>…                    speakers.write_speakers
//!     kikiwake-dev words <ojf.json> <out.json>        whisper-cli -ojf → 語（DTW＋区切りの終わりで頭打ち）
//!     kikiwake-dev turns <nemo.json> <out.json>       nemo-speech diarize の JSON → 話者区間
//!     kikiwake-dev assign <words> <turns> <out.json>  語への話者の割り当て（割当のみの採点用）
//!     kikiwake-dev screen <dir>…                      画面向け一式（結果の表示・話者カード・確認用の手がかり・保存するファイル）
//!     kikiwake-dev repeats <turns.json|-> <ojf.json>…  繰り返しの検出（本文は出さない。範囲・回数・話していた秒数だけ）
//!     kikiwake-dev save <dir>…                        版3の保存（dir の edits.json の手直しを当てて dir/saved/ に md・txt・json）

use std::fs;
use std::process::ExitCode;

use kikiwake_core::merge::{self, Names};
use kikiwake_core::lines::{self, LineEdits, SaveFormat};
use kikiwake_core::{diar, patterns, pycompat, pyjson, repeat, speakers, unresolved, view, whisper};
use serde_json::{Value, json};

fn spans(re: &regex::Regex, s: &str) -> Value {
    re.captures_iter(s)
        .map(|c| {
            let m = c.get(0).unwrap();
            let g = c.get(1).map(|g| g.as_str()).unwrap_or("");
            json!([pycompat::char_index(s, m.start()), pycompat::char_index(s, m.end()), g])
        })
        .collect()
}

fn cmd_pycompat(inp: &str, out: &str) {
    let v: Value = serde_json::from_str(&fs::read_to_string(inp).unwrap()).unwrap();
    let floats: Vec<Value> = v["floats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            let x = x.as_f64().unwrap();
            json!([
                pycompat::repr(x),
                pycompat::repr(pycompat::round(x, 2)),
                pycompat::repr(pycompat::round(x, 3)),
                pycompat::repr(pycompat::round(x, 4)),
                pycompat::percent0(x)
            ])
        })
        .collect();
    let sums: Vec<Value> = v["sums"]
        .as_array()
        .unwrap()
        .iter()
        .map(|xs| json!(pycompat::repr(pycompat::sum(xs.as_array().unwrap().iter().map(|x| x.as_f64().unwrap())))))
        .collect();
    let strings: Vec<Value> = v["strings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            let s = s.as_str().unwrap();
            let split: Vec<&str> = patterns::NEMO_SPLIT.split(pycompat::strip(s)).filter(|p| !p.is_empty()).collect();
            json!({
                "strip": pycompat::strip(s),
                "rstrip": pycompat::rstrip(s),
                "collapse": pycompat::strip(&patterns::collapse_spaces(s)),
                "clean": patterns::clean_name(s),
                "split": split,
                "tail40": pycompat::tail(s, 40),
                "head70": pycompat::head(s, 70),
                "len": pycompat::char_len(s),
                "strong0": spans(&patterns::STRONG_INTRO[0], s),
                "strong1": spans(&patterns::STRONG_INTRO[1], s),
                "weak": spans(&patterns::WEAK_INTRO, s),
                "address": spans(&patterns::ADDRESS, s),
                "halluc": spans(&patterns::HALLUCINATION, s),
            })
        })
        .collect();
    // 全ての文字（サロゲートを除く）で、空白・正規表現の空白・名前の文字に当たるものを列挙
    let mut space = vec![];
    let mut re_space = vec![];
    let mut name = vec![];
    let ws = regex::Regex::new(r"^[\s\x1C-\x1F]$").unwrap();
    for cp in 0..=0x10FFFFu32 {
        let Some(c) = char::from_u32(cp) else { continue };
        let s = c.to_string();
        if pycompat::is_space(c) {
            space.push(cp);
        }
        if ws.is_match(&s) {
            re_space.push(cp);
        }
        if patterns::NAME_CHAR.is_match(&s) {
            name.push(cp);
        }
    }
    let r = json!({"floats": floats, "sums": sums, "strings": strings,
                   "space_cps": space, "re_space_cps": re_space, "name_cps": name});
    fs::write(out, serde_json::to_string(&r).unwrap()).unwrap();
}

fn cmd_json_roundtrip(files: &[String]) -> bool {
    let mut ok = true;
    for f in files {
        let text = fs::read_to_string(f).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        let again = pyjson::dumps(&v);
        if again == text {
            println!("OK {f}");
        } else {
            ok = false;
            let line = text.lines().zip(again.lines()).position(|(a, b)| a != b).map(|i| i + 1);
            println!("NG {f} （最初に違う行: {line:?}）");
        }
    }
    ok
}

fn summary(r: &merge::WriteSummary) -> Value {
    json!({"utterances": r.utterances, "speakers": r.speakers, "unknown_ratio": pycompat::repr(r.unknown_ratio)})
}

fn cmd_merge(dirs: &[String]) {
    for d in dirs {
        let dir = std::path::Path::new(d);
        let plain = merge::write_outputs(dir, None).expect("write_outputs");
        let names_p = dir.join("names.json");
        let named = if names_p.exists() {
            let names: Names = merge::load_json(&names_p).expect("names.json");
            Some(summary(&merge::write_outputs(dir, Some(&names)).expect("write_outputs（実名）")))
        } else {
            None
        };
        println!("{}", json!({"dir": d, "plain": summary(&plain), "named": named}));
    }
}

fn cmd_speakers(dirs: &[String]) {
    for d in dirs {
        let r = speakers::write_speakers(std::path::Path::new(d));
        println!("{}", json!({"dir": d, "error": r.err().map(|e| e.to_string())}));
    }
}

fn cmd_words(inp: &str, out: &str) {
    let segs = whisper::parse_ojf(&fs::read_to_string(inp).unwrap()).expect("-ojf の JSON");
    fs::write(out, pyjson::dumps(&whisper::to_words(&segs))).unwrap();
}

fn cmd_turns(inp: &str, out: &str) {
    let turns = diar::to_turns(&fs::read_to_string(inp).unwrap()).expect("nemo-speech の JSON");
    fs::write(out, pyjson::dumps(&turns)).unwrap();
}

fn cmd_assign(words: &str, turns: &str, out: &str) {
    let w: Vec<merge::Word> = merge::load_json(std::path::Path::new(words)).unwrap();
    let t: Vec<merge::Turn> = merge::load_json(std::path::Path::new(turns)).unwrap();
    fs::write(out, pyjson::dumps(&merge::assign_speakers(&w, &t, 1.0, 0.3))).unwrap();
}

/// dir の words.json・diarization.json・meta.json（audio・duration を使う）・names.json（あれば）から、
/// 画面向けの一式を dir に書く（見本データ contract/fixtures を作ったときと同じ組み立て）。
fn screen(dir: &std::path::Path) -> std::io::Result<()> {
    let words: Vec<merge::Word> = merge::load_json(&dir.join("words.json"))?;
    let turns: Vec<merge::Turn> = merge::load_json(&dir.join("diarization.json"))?;
    let meta: merge::Meta = merge::load_json(&dir.join("meta.json"))?;
    let names_p = dir.join("names.json");
    let names: Option<Names> = if names_p.exists() { Some(merge::load_json(&names_p)?) } else { None };
    let audio = std::path::PathBuf::from(meta.audio.clone().unwrap_or_default());
    let dur = meta.duration.unwrap_or(0.0);
    let utts = merge::build_transcript(&words, &turns, None, 1.0, 1.5);
    let tt = merge::talk_time(&turns, None);
    let plain: Vec<lines::Line> = lines::lines(&words, &turns, None).into_iter().map(|r| r.line).collect();
    fs::write(dir.join("view_transcript.json"), pyjson::dumps(&view::transcript_view(&plain, &tt, &meta, dur, false)))?;
    let sdir = dir.join("samples");
    let _ = fs::remove_dir_all(&sdir);
    fs::create_dir_all(&sdir)?;
    fs::write(dir.join("speakers.json"), pyjson::dumps(&view::speaker_cards(&utts, &turns, &audio, &sdir, "samples/")?))?;
    let hints = unresolved::unresolved_hints(&words, &turns, Some(&audio), Some(&sdir), "samples/")?;
    fs::write(dir.join("unresolved_hints.json"), pyjson::dumps(&hints))?;
    let none = LineEdits::default();
    for (_, content) in lines::save_files(&words, &turns, None, &none, &meta, &[SaveFormat::Md]) {
        fs::write(dir.join("saved_transcript.md"), content)?;
    }
    if let Some(n) = &names {
        fs::write(dir.join("names_out.json"), pyjson::dumps(n))?;
        let named: Vec<lines::Line> = lines::lines(&words, &turns, Some(n)).into_iter().map(|r| r.line).collect();
        let ttn = merge::talk_time(&turns, Some(n));
        fs::write(dir.join("view_transcript_named.json"), pyjson::dumps(&view::transcript_view(&named, &ttn, &meta, dur, true)))?;
        for (_, content) in lines::save_files(&words, &turns, Some(n), &none, &meta, &[SaveFormat::Md]) {
            fs::write(dir.join("saved_transcript_named.md"), content)?;
        }
    }
    Ok(())
}

/// dir の words.json・diarization.json・meta.json・names.json（あれば）・edits.json（あれば）から、
/// 手直しを当てた保存のファイル（md・txt・json）を dir/saved/ に書く。
fn save(dir: &std::path::Path) -> std::io::Result<Vec<String>> {
    let words: Vec<merge::Word> = merge::load_json(&dir.join("words.json"))?;
    let turns: Vec<merge::Turn> = merge::load_json(&dir.join("diarization.json"))?;
    let meta: merge::Meta =
        if dir.join("meta.json").exists() { merge::load_json(&dir.join("meta.json"))? } else { merge::Meta::default() };
    let names: Option<Names> =
        if dir.join("names.json").exists() { Some(merge::load_json(&dir.join("names.json"))?) } else { None };
    let edits: LineEdits =
        if dir.join("edits.json").exists() { merge::load_json(&dir.join("edits.json"))? } else { LineEdits::default() };
    let files = lines::save_files(&words, &turns, names.as_ref(), &edits, &meta, &[SaveFormat::Md, SaveFormat::Txt, SaveFormat::Json]);
    let out = dir.join("saved");
    let _ = fs::remove_dir_all(&out);
    Ok(lines::write_files(&out, &files, false)?.files)
}

fn cmd_save(dirs: &[String]) {
    for d in dirs {
        let r = save(std::path::Path::new(d));
        println!("{}", json!({"dir": d, "files": r.as_ref().ok(), "error": r.err().map(|e| e.to_string())}));
    }
}

fn cmd_screen(dirs: &[String]) {
    for d in dirs {
        let r = screen(std::path::Path::new(d));
        println!("{}", json!({"dir": d, "error": r.err().map(|e| e.to_string())}));
    }
}

fn cmd_repeats(turns: &str, files: &[String]) {
    let turns: Vec<merge::Turn> =
        if turns == "-" { Vec::new() } else { merge::load_json(std::path::Path::new(turns)).expect("turns") };
    for f in files {
        let segs = whisper::parse_ojf(&fs::read_to_string(f).unwrap()).expect("-ojf の JSON");
        let found: Vec<Value> = repeat::find_repeats(&segs)
            .iter()
            .map(|r| {
                let (s, e) = r.range();
                json!({"describe": repeat::describe(r), "start": s, "end": e,
                       "speech_sec": pycompat::round(repeat::speech_seconds(s, e, &turns), 1)})
            })
            .collect();
        println!("{}", json!({"file": f, "segments": segs.len(), "found": found}));
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("pycompat") => cmd_pycompat(&args[1], &args[2]),
        Some("merge") => cmd_merge(&args[1..]),
        Some("speakers") => cmd_speakers(&args[1..]),
        Some("words") => cmd_words(&args[1], &args[2]),
        Some("turns") => cmd_turns(&args[1], &args[2]),
        Some("assign") => cmd_assign(&args[1], &args[2], &args[3]),
        Some("screen") => cmd_screen(&args[1..]),
        Some("repeats") => cmd_repeats(&args[1], &args[2..]),
        Some("save") => cmd_save(&args[1..]),
        Some("json-roundtrip") => {
            if !cmd_json_roundtrip(&args[1..]) {
                return ExitCode::FAILURE;
            }
        }
        _ => {
            eprintln!("使い方: kikiwake-dev pycompat <in> <out> | json-roundtrip <file>…");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
