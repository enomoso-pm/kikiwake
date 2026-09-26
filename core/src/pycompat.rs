//! Python（移植元の Python 版は 3.12）と同じ結果を出すための小さな部品。
//!
//! Rust の標準の動きが Python と違う所だけをここに集める（Phase 1 の下調べで実測したもの）:
//! - 小数の書き方 `repr(x)`: 最短の桁で、指数は `1e-05` / `1e+16` の形。Rust の既定は `1e-5`
//! - 合計 `sum()`: 3.12 から誤差を補正する（Neumaier）。素直に足すと 0.1 を10回で 0.9999999999999999（Python は 1.0）
//! - 空白 `str.isspace()` と正規表現の `\s`: U+001C〜001F も空白。Rust の `char::is_whitespace` は含まない
//! - 最大・最小: 同点なら先に来たほうを返す。Rust の `Iterator::max_by` は後のほうを返す
//! - 文字数と切り出し: Python は文字単位、Rust の `str` はバイト単位
//!
//! 丸め `round(x, n)` は、Rust の書式指定の丸め（2進数の値がちょうど半分なら偶数へ）が Python と同じなので、それを使う。

/// Python の `round(x, ndigits)`（ndigits ≥ 0）。10進で正しく丸めた文字列を読み直す（CPython の double_round と同じ手順）。
pub fn round(x: f64, ndigits: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    format!("{x:.ndigits$}").parse().expect("丸めた数を読み直せない")
}

/// Python の `repr(x)`（float）。json.dumps の小数もこの書き方になる。
pub fn repr(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "inf".into() } else { "-inf".into() };
    }
    // Rust の {:e} は最短で読み戻せる桁を出す（Python の repr と同じ桁）。例 57.37 → "5.737e1"
    let e = format!("{x:e}");
    let (sign, rest) = match e.strip_prefix('-') {
        Some(r) => ("-", r),
        None => ("", e.as_str()),
    };
    let (mant, exp) = rest.split_once('e').expect("指数の書式");
    let mut exp: i32 = exp.parse().expect("指数");
    let mut digits: String = mant.chars().filter(|c| *c != '.').collect();
    // 最短の候補が2つあって同じ近さのとき、Python（dtoa）は末尾が偶数のほうを、Rust は切り上げたほうを選ぶ。
    // 2進数の値の正確な10進の展開が「最短＋1桁で末尾が5」のときだけ起きる。展開が18桁以下になるのは、
    // 小数の部分が 2^-25 の倍数の数だけ（例 12345 + 1/4096）。丸めた時刻や割合（23.26 など）では起きない
    let scaled = x.abs() * 33_554_432.0; // 2^25 倍（2のべきを掛けるので誤差は出ない）
    if x.fract() != 0.0 && scaled.is_finite() && scaled.fract() == 0.0 {
        let full = format!("{:.40e}", x.abs()); // 正確な10進の展開（末尾は0で埋まる）
        let (fm, fe) = full.split_once('e').expect("指数の書式");
        let exact: String = fm.chars().filter(|c| *c != '.').collect::<String>().trim_end_matches('0').to_string();
        let n = digits.len();
        if exact.len() == n + 1 && exact.ends_with('5') {
            let trunc = &exact[..n];
            let last = trunc.as_bytes()[n - 1] - b'0';
            let fe: i32 = fe.parse().expect("指数");
            let back: f64 = format!("{}{}.{}e{}", sign, &trunc[..1], &trunc[1..], fe).parse().expect("読み直し");
            if last % 2 == 0 && back == x {
                digits = trunc.to_string();
                exp = fe;
            }
        }
    }
    let n = digits.len() as i32;
    let decpt = exp + 1; // 値 = 0.d1d2… × 10^decpt
    if decpt <= -4 || decpt > 16 {
        let m = if n > 1 { format!("{}.{}", &digits[..1], &digits[1..]) } else { digits.clone() };
        let (es, ev) = if exp < 0 { ('-', -exp) } else { ('+', exp) };
        format!("{sign}{m}e{es}{ev:02}")
    } else if decpt <= 0 {
        format!("{sign}0.{}{digits}", "0".repeat((-decpt) as usize))
    } else if decpt < n {
        format!("{sign}{}.{}", &digits[..decpt as usize], &digits[decpt as usize..])
    } else {
        format!("{sign}{digits}{}.0", "0".repeat((decpt - n) as usize))
    }
}

/// Python の `f"{x:.0%}"`（100倍してから整数に丸める。ちょうど半分は偶数へ）。
pub fn percent0(x: f64) -> String {
    format!("{:.0}%", x * 100.0)
}

/// Python 3.12 の `sum()`（開始値 0、要素はすべて float）。Neumaier の補正つきの足し算。
pub fn sum<I: IntoIterator<Item = f64>>(xs: I) -> f64 {
    let mut it = xs.into_iter();
    let Some(first) = it.next() else {
        return 0.0;
    };
    let mut f = 0.0 + first; // 開始値の整数 0 に最初の要素を足した時点で float になる
    let mut c = 0.0;
    for x in it {
        let t = f + x;
        if f.abs() >= x.abs() {
            c += (f - t) + x;
        } else {
            c += (x - t) + f;
        }
        f = t;
    }
    if c != 0.0 && c.is_finite() {
        f += c;
    }
    f
}

/// Python の `max(a, b)`（同点なら a）。
pub fn max(a: f64, b: f64) -> f64 {
    if b > a { b } else { a }
}

/// Python の `min(a, b)`（同点なら a）。
pub fn min(a: f64, b: f64) -> f64 {
    if b < a { b } else { a }
}

/// Python の `str.isspace()` の1文字版（正規表現の `\s` も同じ文字の集まり）。
pub fn is_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// Python の `s.strip()`。
pub fn strip(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// Python の `s.rstrip()`。
pub fn rstrip(s: &str) -> &str {
    s.trim_end_matches(is_space)
}

/// Python の `len(s)`（文字数）。
pub fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// Python の `s[:n]`（先頭の n 文字）。
pub fn head(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// Python の `s[-n:]`（末尾の n 文字。n が文字数以上なら全体）。
pub fn tail(s: &str, n: usize) -> &str {
    let len = char_len(s);
    if n >= len {
        return s;
    }
    match s.char_indices().nth(len - n) {
        Some((i, _)) => &s[i..],
        None => "",
    }
}

/// Python の `s[n:]`（n 文字目から後ろ）。
pub fn skip(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[i..],
        None => "",
    }
}

/// バイト位置 → 文字の位置（正規表現の一致位置を Python の添字にそろえる）。
pub fn char_index(s: &str, byte: usize) -> usize {
    s[..byte].chars().count()
}

/// Python の `int(x)`（0 に向かって切り捨て）。
pub fn int(x: f64) -> i64 {
    x.trunc() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repr_like_python() {
        let cases = [
            (57.37, "57.37"),
            (57.0, "57.0"),
            (0.0, "0.0"),
            (-0.0, "-0.0"),
            (1e-05, "1e-05"),
            (0.0001, "0.0001"),
            (1e16, "1e+16"),
            (1234567890123456.0, "1234567890123456.0"),
            (1.5e-07, "1.5e-07"),
            (0.1 + 0.2, "0.30000000000000004"),
            (163.85, "163.85"),
            // 最短の候補が2つ同じ近さ（…740.125 は .12 と .13 の真ん中）。Python は偶数の .12 を選ぶ
            (232341691672740.125, "232341691672740.12"),
            (-260505147091459.625, "-260505147091459.62"),
            (12345.0 + 1.0 / 4096.0, "12345.000244140625"),
        ];
        for (x, want) in cases {
            assert_eq!(repr(x), want, "{x:?}");
        }
    }

    #[test]
    fn round_half_even_like_python() {
        assert_eq!(round(0.125, 2), 0.12);
        assert_eq!(round(0.375, 2), 0.38);
        assert_eq!(round(2.675, 2), 2.67); // 2進数では 2.67499…
        assert_eq!(repr(round(-0.001, 2)), "-0.0");
    }

    #[test]
    fn sum_is_compensated_like_python312() {
        assert_eq!(sum(vec![0.1; 10]), 1.0);
        assert_eq!(sum(Vec::<f64>::new()), 0.0);
    }

    #[test]
    fn space_includes_information_separators() {
        assert!(is_space('\u{1c}') && is_space('\u{3000}') && !is_space('a'));
        assert_eq!(strip("\u{1f} a \u{3000}"), "a");
    }

    #[test]
    fn slicing_by_chars() {
        assert_eq!(head("田中です", 2), "田中");
        assert_eq!(tail("田中です", 2), "です");
        assert_eq!(tail("田中", 40), "田中");
        assert_eq!(skip("田中です", 2), "です");
    }
}
