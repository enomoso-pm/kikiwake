//! Python の `json.dumps(obj, ensure_ascii=False, indent=1)` と同じ書き出し。
//!
//! Python 版の出力（transcript.json・speaker_hints.json・names.json）と一字一句同じにするため。
//! 改行・字下げ（1文字）・区切り（`,` と `: `）・文字のエスケープは serde_json の整形と同じなので借り、
//! 小数だけ Python の書き方（`57.0`・`1e-05`）にする。NaN と無限大は Python と違って null になる（出力には現れない）。

use std::io;

use serde::Serialize;
use serde_json::ser::{Formatter, PrettyFormatter};

use crate::pycompat;

struct PyFormatter<'a>(PrettyFormatter<'a>);

impl Formatter for PyFormatter<'_> {
    fn write_f64<W: ?Sized + io::Write>(&mut self, w: &mut W, v: f64) -> io::Result<()> {
        w.write_all(pycompat::repr(v).as_bytes())
    }
    fn write_f32<W: ?Sized + io::Write>(&mut self, w: &mut W, v: f32) -> io::Result<()> {
        self.write_f64(w, v as f64)
    }
    fn begin_array<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        self.0.begin_array(w)
    }
    fn end_array<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        self.0.end_array(w)
    }
    fn begin_array_value<W: ?Sized + io::Write>(&mut self, w: &mut W, first: bool) -> io::Result<()> {
        self.0.begin_array_value(w, first)
    }
    fn end_array_value<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        self.0.end_array_value(w)
    }
    fn begin_object<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        self.0.begin_object(w)
    }
    fn end_object<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        self.0.end_object(w)
    }
    fn begin_object_key<W: ?Sized + io::Write>(&mut self, w: &mut W, first: bool) -> io::Result<()> {
        self.0.begin_object_key(w, first)
    }
    fn begin_object_value<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        self.0.begin_object_value(w)
    }
    fn end_object_value<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        self.0.end_object_value(w)
    }
}

/// `json.dumps(v, ensure_ascii=False, indent=1)` と同じ文字列（末尾に改行は付かない）。
pub fn dumps<T: Serialize + ?Sized>(v: &T) -> String {
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, PyFormatter(PrettyFormatter::with_indent(b" ")));
    v.serialize(&mut ser).expect("JSON に書き出せない");
    String::from_utf8(buf).expect("UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn same_layout_as_python() {
        let v = json!([{"start": 1.46, "end": 11.0, "speaker": "話者A", "text": "a\"b\n", "overlap": false}, [], {}]);
        assert_eq!(
            dumps(&v),
            "[\n {\n  \"start\": 1.46,\n  \"end\": 11.0,\n  \"speaker\": \"話者A\",\n  \"text\": \"a\\\"b\\n\",\n  \"overlap\": false\n },\n [],\n {}\n]"
        );
    }
}
