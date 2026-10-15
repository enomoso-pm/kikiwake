//! 画面の絵の読み取り（マニュアルの素材。2026-10-12 決定）。
//!
//! 画面共有の録画から、場面ごとの絵と目印を決める。decode-avf frames-scan が 1 秒に 1 枚の「小さな升の明るさ」
//! （横 160 の白黒。1080p なら 12×12 画素ごとの平均）と顔の位置（Mac の Vision）を書き、ここで判定する。
//! 絵そのものは保存のときに decode-avf frames-export が元の録画から取り出す（ここでは時刻と黒く塗る四角を決めるだけ）。
//!
//! 考え方（2026-10-12 の会話で決めた。数値はすべて仮で、Zoom・Teams・Meet の録画で測ってから決める）:
//!   1. 升目（小さな升 2×2。1080p なら 24×24 画素）ごとに、1 秒前と比べて変わったかを見る（小さな升のどれかの明るさの差が 4 以上）。
//!      特徴点は使わない（画面の録画はカメラが動かないので、同じ場所の明るさで「どこが変わったか」まで分かる）
//!   2. カメラの四角: 動いている顔（顔のまわりが前後 30 秒で 2 回以上変わった。写真の顔は変わらないので外れる）を頭と肩まで広げたもの、
//!      顔は見えないが、画面の端に接した小さな所（画面の 15% 以下）で、前後 2 分半の半分以上の秒で変わり続けている所
//!      （2026-10-12: 実物の 2 時間半の録画で、数十秒だけ動いたスクロールなどを小窓とみなし、区間のあいだずっと塗って画面の 58% が黒くなった。
//!      小窓は長く動き続けるものだけにした）
//!   3. カメラの四角が画面の 30% 以上（または動き続ける所が画面の半分以上）が 5 秒続く時間は「カメラの時間」（絵を出さない）
//!   4. 共有の時間を「状態」（画面が落ち着いている間のひとまとまり）に区切る。カメラの四角と 4 升以下の小さなかたまり（マウスの矢印など）は見ない。
//!      基準の絵と 10 升以上違い、そのあと 2 秒静かなら新しい状態。変わった所を囲む四角が画面の半分以上なら場面の切り替わり、それ未満は画面の中の変化
//!   5. 前に出てきた状態と同じなら「前と同じ」（絵を出さない）、8 秒以内に元へ戻った表示は「一時的な表示」（通知などの中身を出さない）、
//!      10 秒以上落ち着かない時間は「動きの多い時間」（真ん中の 1 枚）
//!   6. 状態の絵は最後の 1 枚（変わる直前。読み込みが終わり、次に押すボタンの上に矢印が乗っていることが多い）。カメラの四角は黒く塗る。
//!      共有の区間の 3 割以上の秒で見つかった端の四角は、区間のあいだずっと塗る（人がじっとしていて動きを拾えない時間も漏らさない）。
//!      それ以外の四角は、見つかった秒の前後 30 秒だけ塗る。塗るのは見つかった形のまま（囲む大きな四角にしない）
//!   7. 絵を間引く（2026-10-12 決定。実物の 2 時間半の録画で 546 枚 → 216 枚。絵は JPEG）: 動きの多い時間は絵を出さずに次の画面にまとめ、
//!      5 秒未満で次に移った画面の中の変化も次の画面にまとめ、同じ所で続く画面の中の変化は最後の 1 枚にまとめる。
//!      まとめても区間の時間は残るので、発言は消えない（まとめた先の区間に入る）。「前と同じ」が指す区間はまとめない
//!   8. 発言は、発言の真ん中の時刻が入っている区間に 1 回だけ付ける
//!   9. 会議アプリの参加者の枠・まわりの黒い帯を外し、共有した画面の部分だけを絵にする（2026-10-13 決定。迷ったら切らない。
//!      決め方は「共有した画面の四角（切り出し）」の節）

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use crate::lang::Lang;
use crate::merge::{self, UNKNOWN, Utterance};

// ---- 読み取りの結果（decode-avf frames-scan が書く） --------------------------------------------

/// 読み取りのファイルの頭。続けて 映像の幅・高さ（u32）、小さな升の横・縦の数（u16）。
/// そのあと 1 秒ごとに 時刻（ミリ秒・u32）、顔の数（u8）、顔ごとに x・y・幅・高さ（u16。1/10000 単位・左上が原点）、小さな升の明るさ（横×縦 バイト）。
/// すべてリトルエンディアン
pub const SCAN_MAGIC: &[u8; 4] = b"KWS1";

/// 画面の中の四角（左上が原点、幅と高さに対する割合 0〜1）
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 1 秒ごとの 1 枚
#[derive(Clone, Debug, PartialEq)]
pub struct ScanFrame {
    /// 録画の頭からの秒
    pub t: f64,
    /// Vision が見つけた顔
    pub faces: Vec<Rect>,
    /// 小さな升の明るさ（横 sig_w × 縦 sig_h。上の行から）
    pub sig: Vec<u8>,
}

/// 読み取りの結果
#[derive(Clone, Debug, PartialEq)]
pub struct Scan {
    pub video_w: u32,
    pub video_h: u32,
    pub sig_w: usize,
    pub sig_h: usize,
    pub frames: Vec<ScanFrame>,
}

impl Scan {
    /// decode-avf frames-scan が書いたファイルを読む。途中で切れた最後の 1 枚は捨てる（中止したとき）
    pub fn from_bytes(b: &[u8]) -> Result<Scan, String> {
        if b.len() < 16 || &b[0..4] != SCAN_MAGIC {
            return Err("画面の読み取りのファイルの形が違う".into());
        }
        let u32_at = |p: usize| u32::from_le_bytes([b[p], b[p + 1], b[p + 2], b[p + 3]]);
        let u16_at = |p: usize| u16::from_le_bytes([b[p], b[p + 1]]);
        let (video_w, video_h) = (u32_at(4), u32_at(8));
        let (sig_w, sig_h) = (u16_at(12) as usize, u16_at(14) as usize);
        let size = sig_w * sig_h;
        let mut frames = Vec::new();
        let mut p = 16;
        while p + 5 <= b.len() {
            let t = u32_at(p) as f64 / 1000.0;
            let n = b[p + 4] as usize;
            p += 5;
            if p + n * 8 + size > b.len() {
                break;
            }
            let at = |q: usize| u16_at(q) as f64 / 10000.0;
            let faces = (0..n).map(|k| p + k * 8).map(|q| Rect { x: at(q), y: at(q + 2), w: at(q + 4), h: at(q + 6) }).collect();
            p += n * 8;
            frames.push(ScanFrame { t, faces, sig: b[p..p + size].to_vec() });
            p += size;
        }
        Ok(Scan { video_w, video_h, sig_w, sig_h, frames })
    }

    /// from_bytes の逆（テストと開発用の道具）
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(16 + self.frames.len() * (5 + self.sig_w * self.sig_h));
        b.extend_from_slice(SCAN_MAGIC);
        b.extend_from_slice(&self.video_w.to_le_bytes());
        b.extend_from_slice(&self.video_h.to_le_bytes());
        b.extend_from_slice(&(self.sig_w as u16).to_le_bytes());
        b.extend_from_slice(&(self.sig_h as u16).to_le_bytes());
        let q = |v: f64| ((v.clamp(0.0, 1.0) * 10000.0).round() as u16).to_le_bytes();
        for f in &self.frames {
            b.extend_from_slice(&((f.t * 1000.0).round() as u32).to_le_bytes());
            b.push(f.faces.len().min(255) as u8);
            for r in f.faces.iter().take(255) {
                for v in [r.x, r.y, r.w, r.h] {
                    b.extend_from_slice(&q(v));
                }
            }
            b.extend_from_slice(&f.sig);
        }
        b
    }
}

// ---- 判定の数値（すべて仮） --------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScreensConfig {
    /// 小さな升の明るさ（256 段階）の差がこれ以上なら、その升目は「変わった」
    pub cell_delta: u8,
    /// 動き続けているかを見る幅（前後の秒）
    pub window_sec: usize,
    /// 顔のまわりが、前後 window_sec 秒にこの回数以上変わったら「動いている顔」（写真の顔は 0 回）
    pub face_moves: usize,
    /// この割合以上の秒で変わった升目は「動き続けている」（顔の見えない小窓は前後 tile_window_sec 秒で、ギャラリー表示は前後 window_sec 秒で見る）
    pub tile_rate: f64,
    /// 顔の見えない小窓は、前後この秒数を見て動き続けているかを決める（数十秒のスクロール・動画を小窓としないように）
    pub tile_window_sec: usize,
    /// 顔の見えない小窓とみなす大きさの上限（画面に対する割合。Zoom の小窓は 3% ほど、Teams の帯は 10% ほど）
    pub tile_max_area: f64,
    /// 共有の区間のこの割合以上の秒で見つかった端の四角は、区間のあいだずっと塗る（それ以外は見つかった秒の前後 window_sec 秒だけ）
    pub persist_rate: f64,
    /// 区間のあいだずっと塗る所の上限（画面に対する割合。広げる決まりはここで止まる）
    pub mask_max_area: f64,
    /// カメラの四角がこの割合以上なら、カメラの時間
    pub camera_area: f64,
    /// 顔が見つからなくても、動き続ける所がこの割合以上なら、カメラの時間（ギャラリー表示など）
    pub live_area: f64,
    /// カメラの時間と共有の時間は、この秒数続いてから切り替える
    pub switch_sec: usize,
    /// これ以下の升目のかたまりは見ない（マウスの矢印・文字のカーソル）
    pub small_blob: usize,
    /// 基準の絵とこの升目以上違えば、画面が変わった
    pub state_cells: usize,
    /// 変わったあと、この秒数静かなら新しい状態
    pub settle_sec: usize,
    /// 変わった所を囲む四角がこの割合以上なら、場面の切り替わり（未満は画面の中の変化）
    pub scene_area: f64,
    /// この秒数より短く、元の画面へ戻った状態は一時的な表示（通知など）
    pub transient_sec: f64,
    /// この秒数以上静かにならない時間は、動きの多い時間
    pub busy_sec: usize,
    /// 変わった所を囲む四角の、この割合以上がカメラの四角と重なっていたら、その変化はカメラのもの（四角を広げる）
    pub grow_overlap: f64,
    /// 間引き: 動きの多い時間は絵を出さず、次の画面にまとめる
    pub drop_busy: bool,
    /// 間引き: この秒数より短く次に移った画面の中の変化は、次の画面にまとめる（0 ならまとめない）
    pub min_step_sec: f64,
    /// 間引き: 続けて起きた画面の中の変化で、変わった所の重なりが小さいほうのこの割合以上なら、最後の 1 枚にまとめる（0 ならまとめない）
    pub merge_overlap: f64,
    /// 切り出し（2026-10-13 決定）: 会議アプリの参加者の枠・まわりの帯を外し、共有した画面の部分だけを絵にする。迷ったら切らない
    pub crop: bool,
    /// 切り出し: 共有した画面の四角は、前後この秒数の様子から決める（並びが途中で変わっても、この秒数たてば新しい並びで決め直す）
    pub crop_window_sec: usize,
    /// 切り出し: 四角を決め直す間隔（秒）
    pub crop_step_sec: usize,
    /// 切り出し: 画面のこの割合以上の升目が同時に変わった秒を「大きな変化」とする（スライドや窓の切り替え。カメラの四角は数えない）
    pub crop_big: f64,
    /// 切り出し: 大きな変化がこの回数より少なければ、四角を決めない（切らない）
    pub crop_min_big: usize,
    /// 切り出し: 大きな変化のこの割合以上で一緒に変わり、
    pub crop_part: f64,
    /// 切り出し: ふだんの秒（大きな変化でない秒）に変わる割合のこの倍以上なら、共有した画面の升目（会議アプリの枠の話す人の印などは、大きな変化と関係なく変わる）
    pub crop_lift: f64,
    /// 切り出し: 共有した画面の升目がこの割合以上ある列（行）だけで、四角を囲む（話している印などの数升で四角を広げない）
    pub crop_line_part: f64,
    /// 切り出し: 境目の内と外で、小さな升の明るさがこれ以上違うこと
    pub crop_edge: u8,
    /// 切り出し: その違いが、境目の長さのこの割合以上あること
    pub crop_edge_rate: f64,
    /// 切り出し: 切る帯の模様の細かさ（となりと明るさが 24 以上違う組の割合）の上限。無地に近い帯だけを切る（文字やアイコンの並ぶメニューは切らない）
    pub crop_texture: f64,
    /// 切り出し: 境目のすぐ外の 2 本の模様の細かさの上限（細いので、参加者の枠の名前が境目に接しているだけで上がる。
    /// 窓の明るい縁の 1 本を境目とまちがえないための決まり）
    pub crop_edge_texture: f64,
    /// 切り出し: 切る帯の升目が、この割合を超える秒で変わっていたら切らない（動画など。カメラとして塗る所は除く）
    pub crop_quiet: f64,
    /// 切り出し: 切る帯の地の色が、境目の内側にもこの割合以上あったら、共有した画面の余白（スライドの白い余白など）とみなして切らない
    pub crop_continue: f64,
    /// 切り出し: 残す四角は画面のこの割合以上
    pub crop_keep_min: f64,
    /// 切り出し: 切るのは画面のこの割合以上のときだけ（細い縁だけなら切らない）
    pub crop_cut_min: f64,
    /// 切り出し: 1 つの辺で切るのは、幅（高さ）のこの割合まで
    pub crop_side_max: f64,
    /// 切り出し: 絵ごとに、切る帯がいつもの見た目（前後の平均）から明るさでこれ以上（平均）違えば、その辺は切らない（並びが変わって中身が入り込んだ）
    pub crop_same: f64,
}

impl Default for ScreensConfig {
    fn default() -> Self {
        Self {
            cell_delta: 4,
            window_sec: 30,
            face_moves: 2,
            tile_rate: 0.5,
            tile_window_sec: 150,
            tile_max_area: 0.15,
            persist_rate: 0.3,
            mask_max_area: 0.25,
            camera_area: 0.3,
            live_area: 0.5,
            switch_sec: 5,
            small_blob: 4,
            state_cells: 10,
            settle_sec: 2,
            scene_area: 0.5,
            transient_sec: 8.0,
            busy_sec: 10,
            grow_overlap: 0.5,
            drop_busy: true,
            min_step_sec: 5.0,
            merge_overlap: 0.5,
            crop: true,
            crop_window_sec: 300,
            crop_step_sec: 60,
            crop_big: 0.15,
            crop_min_big: 3,
            crop_part: 0.05,
            crop_lift: 3.0,
            crop_line_part: 0.1,
            crop_edge: 16,
            crop_edge_rate: 0.6,
            crop_texture: 0.03,
            crop_edge_texture: 0.1,
            crop_quiet: 0.5,
            crop_continue: 0.2,
            crop_keep_min: 0.3,
            crop_cut_min: 0.02,
            crop_side_max: 0.45,
            crop_same: 10.0,
        }
    }
}

// ---- 判定の結果（作業フォルダの screens.json） -------------------------------------------------

/// screens.json の形の版（形や判定を変えたら上げる。古い版の結果は使わず、読み取りからやり直す）。
/// 版2（2026-10-12）: 小窓の決め方と塗り方を直した（版1 は実物の録画で画面の 58% を塗った）。
/// 版3（2026-10-12）: 絵を間引く・絵は JPEG（frames/0001.jpg）
/// 版4（2026-10-13）: 会議アプリの参加者の枠・まわりの帯を外す（Span.crop）。四角の外の変化は数えず、場面の切り替わりは四角に対する大きさで決める
pub const SCREENS_VERSION: u32 = 4;

/// 区間の種類
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpanKind {
    /// 場面の切り替わり（画面の大半が替わった。共有の時間の始まりも）
    Scene,
    /// 画面の中の変化（一部だけ替わった）
    Step,
    /// 動きの多い時間（スクロール・動画の再生など。真ん中の 1 枚）
    Busy,
    /// カメラの時間（画面の共有なし。絵を出さない）
    Camera,
}

/// 区間（録画の頭から終わりまで、すき間なく並ぶ）
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    /// 1 から
    pub id: usize,
    pub kind: SpanKind,
    /// 秒
    pub start: f64,
    pub end: f64,
    /// 絵を取り出す時刻（秒）。カメラの時間・前と同じ・一時的な表示には無い
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_t: Option<f64>,
    /// 絵のファイル（zip の中。"frames/0001.jpg"）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<String>,
    /// 前に出てきた同じ画面の区間
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same_as: Option<usize>,
    /// すぐ元の画面に戻った表示（通知など）。絵を出さない
    #[serde(default, skip_serializing_if = "is_false")]
    pub transient: bool,
    /// 画面の中の変化で、変わった所（録画全体に対する割合。zip の timeline では絵に対する割合に直す）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed: Option<Rect>,
    /// 絵にする所（共有した画面の四角。会議アプリの参加者の枠などを外した。録画全体に対する割合）。無ければ録画の全体
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Rect>,
    /// 絵で黒く塗る四角（カメラ。録画全体に対する割合）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub masks: Vec<Rect>,
    /// 絵に顔が写っているかもしれない（黒く塗った所の外で Vision が顔を見つけた。写真の顔など）
    #[serde(default, skip_serializing_if = "is_false")]
    pub faces: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// 数のまとめ（画面に出す）
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// 絵の枚数（zip に入る）
    pub frames: usize,
    /// 場面の切り替わり（前と同じ・一時的な表示を除く）
    pub scenes: usize,
    /// 画面の中の変化（同じく）
    pub steps: usize,
    /// 顔が写っているかもしれない絵
    pub faces: usize,
    /// 共有した画面の部分だけを切り出した絵（会議アプリの参加者の枠などを外した）
    #[serde(default)]
    pub cropped: usize,
    /// 画面共有の時間（秒）
    pub share_sec: f64,
    /// カメラの時間（秒）
    pub camera_sec: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Screens {
    pub version: u32,
    pub video_w: u32,
    pub video_h: u32,
    pub duration_sec: f64,
    pub spans: Vec<Span>,
    pub summary: Summary,
}

// ---- 升目 ------------------------------------------------------------------------------------

/// 升目の四角 [x0, x1) × [y0, y1)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Cells {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
}

impl Cells {
    fn area(&self) -> usize {
        self.x1.saturating_sub(self.x0) * self.y1.saturating_sub(self.y0)
    }

    fn union(&self, o: &Cells) -> Cells {
        Cells { x0: self.x0.min(o.x0), y0: self.y0.min(o.y0), x1: self.x1.max(o.x1), y1: self.y1.max(o.y1) }
    }
}

/// 小さな升（横 sw）を 2×2 ずつまとめた升目（横 cw・縦 ch）
struct Grid {
    sw: usize,
    cw: usize,
    ch: usize,
}

impl Grid {
    fn new(sw: usize, sh: usize) -> Self {
        Self { sw, cw: sw / 2, ch: sh / 2 }
    }

    fn n(&self) -> usize {
        self.cw * self.ch
    }

    /// 升目ごとに、a と b で小さな升のどれかの明るさが delta 以上違うか
    fn changed(&self, a: &[u8], b: &[u8], delta: u8, out: &mut [bool]) {
        let sw = self.sw;
        for cy in 0..self.ch {
            for cx in 0..self.cw {
                let k = 2 * cy * sw + 2 * cx;
                out[cy * self.cw + cx] = a[k].abs_diff(b[k]) >= delta
                    || a[k + 1].abs_diff(b[k + 1]) >= delta
                    || a[k + sw].abs_diff(b[k + sw]) >= delta
                    || a[k + sw + 1].abs_diff(b[k + sw + 1]) >= delta;
            }
        }
    }

    fn to_cells(&self, r: &Rect) -> Cells {
        let fx = |v: f64, n: usize| ((v.clamp(0.0, 1.0) * n as f64).floor() as usize).min(n);
        let cx = |v: f64, n: usize| ((v.clamp(0.0, 1.0) * n as f64).ceil() as usize).min(n);
        Cells { x0: fx(r.x, self.cw), y0: fx(r.y, self.ch), x1: cx(r.x + r.w, self.cw), y1: cx(r.y + r.h, self.ch) }
    }

    fn to_rect(&self, c: &Cells) -> Rect {
        let (w, h) = (self.cw as f64, self.ch as f64);
        let r4 = |v: f64| (v * 10000.0).round() / 10000.0;
        Rect { x: r4(c.x0 as f64 / w), y: r4(c.y0 as f64 / h), w: r4(c.area_w() as f64 / w), h: r4(c.area_h() as f64 / h) }
    }

    fn touches_edge(&self, c: &Cells) -> bool {
        c.x0 == 0 || c.y0 == 0 || c.x1 >= self.cw || c.y1 >= self.ch
    }

    fn fill(&self, m: &mut [bool], c: &Cells) {
        for y in c.y0..c.y1.min(self.ch) {
            for x in c.x0..c.x1.min(self.cw) {
                m[y * self.cw + x] = true;
            }
        }
    }

    /// 四角の中で m が立っている升目の数
    fn covered(&self, m: &[bool], c: &Cells) -> usize {
        (c.y0..c.y1.min(self.ch)).map(|y| (c.x0..c.x1.min(self.cw)).filter(|&x| m[y * self.cw + x]).count()).sum()
    }

    /// 立っている升目の、上下左右でつながったかたまり
    fn blobs(&self, on: &[bool]) -> Vec<Blob> {
        let mut seen = vec![false; on.len()];
        let mut out = Vec::new();
        let mut q = VecDeque::new();
        for s in 0..on.len() {
            if !on[s] || seen[s] {
                continue;
            }
            seen[s] = true;
            q.push_back(s);
            let mut cells = Vec::new();
            let (sx, sy) = (s % self.cw, s / self.cw);
            let mut rect = Cells { x0: sx, y0: sy, x1: sx + 1, y1: sy + 1 };
            while let Some(c) = q.pop_front() {
                cells.push(c);
                let (x, y) = (c % self.cw, c / self.cw);
                rect = rect.union(&Cells { x0: x, y0: y, x1: x + 1, y1: y + 1 });
                let mut push = |nc: usize| {
                    if on[nc] && !seen[nc] {
                        seen[nc] = true;
                        q.push_back(nc);
                    }
                };
                if x > 0 {
                    push(c - 1);
                }
                if x + 1 < self.cw {
                    push(c + 1);
                }
                if y > 0 {
                    push(c - self.cw);
                }
                if y + 1 < self.ch {
                    push(c + self.cw);
                }
            }
            out.push(Blob { cells, rect });
        }
        out
    }

    /// かたまりの上下左右のどれかが m に接しているか
    fn adjacent(&self, b: &Blob, m: &[bool]) -> bool {
        b.cells.iter().any(|&c| {
            let (x, y) = (c % self.cw, c / self.cw);
            (x > 0 && m[c - 1]) || (x + 1 < self.cw && m[c + 1]) || (y > 0 && m[c - self.cw]) || (y + 1 < self.ch && m[c + self.cw])
        })
    }

    /// 立っている升目を、そのままの形の四角の集まり（割合）にする。行ごとの続きを、上下で同じ幅なら 1 つにまとめる
    /// （かたまりを囲む四角にすると、L 字の形などで塗らなくてよい所まで塗るため）
    fn rects(&self, m: &[bool]) -> Vec<Rect> {
        let mut open: Vec<Cells> = Vec::new();
        let mut done: Vec<Cells> = Vec::new();
        for y in 0..self.ch {
            let mut next: Vec<Cells> = Vec::new();
            let mut x = 0;
            while x < self.cw {
                if !m[y * self.cw + x] {
                    x += 1;
                    continue;
                }
                let x0 = x;
                while x < self.cw && m[y * self.cw + x] {
                    x += 1;
                }
                match open.iter().position(|r| r.x0 == x0 && r.x1 == x) {
                    Some(k) => {
                        let mut r = open.remove(k);
                        r.y1 = y + 1;
                        next.push(r);
                    }
                    None => next.push(Cells { x0, y0: y, x1: x, y1: y + 1 }),
                }
            }
            done.append(&mut open);
            open = next;
        }
        done.append(&mut open);
        done.sort_by_key(|c| (c.y0, c.x0));
        done.iter().map(|c| self.to_rect(c)).collect()
    }
}

impl Cells {
    fn area_w(&self) -> usize {
        self.x1.saturating_sub(self.x0)
    }

    fn area_h(&self) -> usize {
        self.y1.saturating_sub(self.y0)
    }
}

struct Blob {
    cells: Vec<usize>,
    rect: Cells,
}

/// 顔の四角を、頭と肩が入るまで広げる（左右に顔の幅 1 つ分、上に高さ半分、下に高さ 2 つ分）
fn expand_face(f: &Rect) -> Rect {
    Rect { x: f.x - f.w, y: f.y - 0.5 * f.h, w: 3.0 * f.w, h: 3.5 * f.h }
}

// ---- 判定 ------------------------------------------------------------------------------------

/// 区切った区間（升目の番号で。終わりは次の区間の始まりで決まる）
#[derive(Clone, Debug)]
enum Piece {
    State { start: usize, last: usize, kind: SpanKind, changed: Option<Cells>, seg: usize },
    Busy { start: usize, end: usize, seg: usize },
    Camera { start: usize },
}

impl Piece {
    fn start(&self) -> usize {
        match self {
            Piece::State { start, .. } | Piece::Busy { start, .. } | Piece::Camera { start } => *start,
        }
    }
}

/// 1 つの共有の区間を状態に区切る
struct SegRun<'a> {
    g: &'a Grid,
    cfg: &'a ScreensConfig,
    frames: &'a [ScanFrame],
    /// その秒の四角（前後 window_sec 秒に見つかった、常駐しない端の四角と真ん中の動く顔）
    center: &'a [Vec<bool>],
    /// 常駐する端の四角（区間のあいだずっと塗る。広げると増える）
    mask: Vec<bool>,
    /// その秒（1 秒前から）が静かだったか
    calm: Vec<Option<bool>>,
    seg: usize,
    /// 切り出した四角（その外の変化は数えない）
    crop: &'a SegCrop,
}

impl SegRun<'_> {
    fn mask_at(&self, i: usize) -> Vec<bool> {
        let out = self.crop.outside_at(i);
        self.mask.iter().zip(&self.center[i]).enumerate().map(|(k, (a, b))| *a || *b || out.is_some_and(|o| o[k])).collect()
    }

    /// i 秒に見ている升目の数（切り出した四角の中。場面の切り替わりは、この数に対する大きさで決める。
    /// 画面全体に対して決めると、共有した画面が小さい並びでは、スライドがまるごと替わっても画面の中の変化になり、
    /// 「同じ所で続く変化」として最後の 1 枚にまとめられてしまう）
    fn shown_cells(&self, i: usize) -> usize {
        let n = self.g.n();
        self.crop.outside_at(i).map_or(n, |o| n - o.iter().filter(|x| **x).count())
    }

    /// 絵 a と絵 b の違い（i の秒のカメラの四角と、小さなかたまりを除く）。カメラの四角に重なる変化（話す人が替わって小窓の背景も
    /// 替わった など）は、四角をそこまで広げて除く
    fn diff(&mut self, a: usize, b: usize, i: usize) -> Vec<Blob> {
        let n = self.g.n();
        let m = self.mask_at(i);
        let mut on = vec![false; n];
        self.g.changed(&self.frames[a].sig, &self.frames[b].sig, self.cfg.cell_delta, &mut on);
        for (o, mm) in on.iter_mut().zip(&m) {
            *o = *o && !*mm;
        }
        let mut out = Vec::new();
        for blob in self.g.blobs(&on) {
            if blob.cells.len() <= self.cfg.small_blob {
                continue;
            }
            if self.grows(&blob, &m) {
                let r = blob.rect;
                self.g.fill(&mut self.mask, &r);
                continue;
            }
            out.push(blob);
        }
        out
    }

    /// 広げるのは、常駐する四角（小窓）の続きだけ。その秒だけの四角からは広げない
    fn grows(&self, b: &Blob, _m: &[bool]) -> bool {
        let m = &self.mask;
        let area = b.rect.area();
        if area == 0 || !m.iter().any(|x| *x) {
            return false;
        }
        // 広げたあとの塗る所が上限（画面の 1/4）を超えるなら広げない（動きの多い画面を次々に吸って、画面全体を塗らないように）
        let now = m.iter().filter(|x| **x).count();
        let added = area - self.g.covered(m, &b.rect);
        if (now + added) as f64 > self.cfg.mask_max_area * self.g.n() as f64 {
            return false;
        }
        if self.g.covered(m, &b.rect) as f64 >= self.cfg.grow_overlap * area as f64 {
            return true;
        }
        // 小窓の続き: 常駐する四角に接していて、端に接したかたまり（大きさは上の上限で止まる）
        self.g.adjacent(b, m) && self.g.touches_edge(&b.rect)
    }

    fn calm(&mut self, j: usize) -> bool {
        if let Some(c) = self.calm[j] {
            return c;
        }
        let c = self.diff(j - 1, j, j).is_empty();
        self.calm[j] = Some(c);
        c
    }

    /// 絵 k が、そのあと settle_sec 秒（区間の終わりが先ならそこまで）変わらない
    fn stable(&mut self, k: usize, e: usize) -> bool {
        let to = (k + self.cfg.settle_sec).min(e);
        (k + 1..=to).all(|j| self.calm(j))
    }

    fn next_stable(&mut self, from: usize, e: usize) -> Option<usize> {
        (from..=e).find(|&k| self.stable(k, e))
    }

    fn cells_of(blobs: &[Blob]) -> usize {
        blobs.iter().map(|b| b.cells.len()).sum()
    }

    /// 区間 [s, e]（両端を含む）を状態と動きの多い時間に区切る
    fn run(&mut self, s: usize, e: usize) -> Vec<Piece> {
        let (busy, state_cells) = (self.cfg.busy_sec, self.cfg.state_cells);
        let seg = self.seg;
        let mut out = Vec::new();
        // 最初の落ち着いた絵
        let Some(k) = self.next_stable(s, e) else {
            out.push(Piece::Busy { start: s, end: e, seg });
            return out;
        };
        let mut cur = if k - s >= busy {
            out.push(Piece::Busy { start: s, end: k - 1, seg });
            (k, k, k, SpanKind::Scene, None) // (start, 基準, 最後, 種類, 変わった所)
        } else {
            (s, k, k, SpanKind::Scene, None)
        };
        let mut i = k + 1;
        while i <= e {
            if Self::cells_of(&self.diff(cur.1, i, i)) < state_cells {
                cur.2 = i;
                i += 1;
                continue;
            }
            // i から変わりはじめた。次に落ち着いた絵を探す
            let cs = i;
            let Some(k) = self.next_stable(i, e) else {
                // 区間の終わりまで落ち着かなかった
                out.push(Piece::State { start: cur.0, last: cur.2, kind: cur.3, changed: cur.4, seg });
                if e + 1 - cs >= busy {
                    out.push(Piece::Busy { start: cs, end: e, seg });
                }
                return out;
            };
            if Self::cells_of(&self.diff(cur.1, k, k)) < state_cells {
                // 元の画面に戻った（メニューを開いて閉じた など）。同じ状態の続き
                cur.2 = k;
                i = k + 1;
                continue;
            }
            out.push(Piece::State { start: cur.0, last: cur.2, kind: cur.3, changed: cur.4, seg });
            let new_start = if k - cs >= busy {
                out.push(Piece::Busy { start: cs, end: k - 1, seg });
                k
            } else {
                cs
            };
            // 前の状態の最後の絵と比べて、変わった所を囲む四角の大きさで種類を決める
            let blobs = self.diff(cur.2, k, k);
            let bbox = blobs.iter().map(|b| b.rect).reduce(|a, b| a.union(&b));
            let (kind, changed) = match bbox {
                Some(r) if (r.area() as f64) < self.cfg.scene_area * self.shown_cells(k) as f64 => (SpanKind::Step, Some(r)),
                _ => (SpanKind::Scene, None),
            };
            cur = (new_start, k, k, kind, changed);
            i = k + 1;
        }
        out.push(Piece::State { start: cur.0, last: cur.2, kind: cur.3, changed: cur.4, seg });
        out
    }
}

/// 短い続きを前後に吸わせる（カメラの時間と共有の時間が min 秒より短く入れ替わらないように）
fn smooth(raw: &[bool], min: usize) -> Vec<bool> {
    let mut runs: Vec<(bool, usize)> = Vec::new();
    for &v in raw {
        match runs.last_mut() {
            Some((x, n)) if *x == v => *n += 1,
            _ => runs.push((v, 1)),
        }
    }
    let mut merged: Vec<(bool, usize)> = Vec::new();
    for (v, n) in runs {
        match merged.last_mut() {
            Some((_, pn)) if n < min => *pn += n,
            Some((pv, pn)) if *pv == v => *pn += n,
            _ => merged.push((v, n)),
        }
        // 吸わせたあとで前と同じ値が並んだらまとめる
        while merged.len() >= 2 && merged[merged.len() - 1].0 == merged[merged.len() - 2].0 {
            let (_, n) = merged.pop().unwrap();
            merged.last_mut().unwrap().1 += n;
        }
    }
    // 頭の短い続きは次へ
    if merged.len() >= 2 && merged[0].1 < min {
        let n = merged.remove(0).1;
        merged[0].1 += n;
    }
    merged.into_iter().flat_map(|(v, n)| std::iter::repeat_n(v, n)).collect()
}

/// 秒ごとのカメラの四角（端に接したもの・真ん中のもの）と、カメラの時間らしいか。どれも [s, e] の秒の分（0 番が s）
struct CamBoxes {
    edge: Vec<Vec<Cells>>,
    center: Vec<Vec<bool>>,
    camera: Vec<bool>,
}

/// 前後 w 秒に「変わった」秒を升目ごとに数える（[s, e] の中の変化だけ。changed[k] は k-1 秒 → k 秒の変化なので、s 秒の変化は区間の外から来る）
struct Slide {
    counts: Vec<u32>,
    /// 数えている範囲 [lo, hi]
    lo: usize,
    hi: usize,
    w: usize,
    s: usize,
    e: usize,
}

impl Slide {
    fn new(c: usize, w: usize, s: usize, e: usize) -> Self {
        Self { counts: vec![0; c], lo: s + 1, hi: s, w, s, e }
    }

    /// i 秒のまわりに動かす。返すのは数えている秒の数
    fn move_to(&mut self, i: usize, changed: &[Vec<bool>]) -> usize {
        let (want_lo, want_hi) = (i.saturating_sub(self.w).max(self.s + 1), (i + self.w).min(self.e));
        while self.hi < want_hi {
            self.hi += 1;
            for (cnt, ch) in self.counts.iter_mut().zip(&changed[self.hi]) {
                *cnt += *ch as u32;
            }
        }
        while self.lo < want_lo {
            if self.lo <= self.hi {
                for (cnt, ch) in self.counts.iter_mut().zip(&changed[self.lo]) {
                    *cnt -= *ch as u32;
                }
            }
            self.lo += 1;
        }
        if self.hi >= self.lo { self.hi - self.lo + 1 } else { 0 }
    }

    /// rate 以上の秒で変わった升目
    fn live(&self, rate: f64, m: usize) -> Vec<bool> {
        self.counts.iter().map(|&k| m > 0 && k as f64 >= rate * m as f64).collect()
    }
}

/// [s, e] の中の変化だけで、動いている顔（顔のまわりが前後 window_sec 秒に face_moves 回以上変わった）と、
/// 顔の見えない小窓（端に接した小さな所で、前後 tile_window_sec 秒の tile_rate 以上の秒で変わった）を見つける
fn camera_boxes(g: &Grid, frames: &[ScanFrame], changed: &[Vec<bool>], cfg: &ScreensConfig, s: usize, e: usize) -> CamBoxes {
    let c = g.n();
    let len = e + 1 - s;
    let mut out = CamBoxes { edge: Vec::with_capacity(len), center: vec![vec![false; c]; len], camera: vec![false; len] };
    let mut short = Slide::new(c, cfg.window_sec, s, e);
    let mut long = Slide::new(c, cfg.tile_window_sec, s, e);
    for i in s..=e {
        let m = short.move_to(i, changed);
        let ml = long.move_to(i, changed);
        let (lo, hi) = (short.lo, short.hi);
        // ギャラリー表示など: 画面の大半が、前後 window_sec 秒の半分以上の秒で変わる
        let live_cov = short.live(cfg.tile_rate, m).iter().filter(|x| **x).count() as f64 / c as f64;
        let mut boxes: Vec<Cells> = Vec::new();
        for f in &frames[i].faces {
            let fc = g.to_cells(f);
            if fc.area() == 0 {
                continue;
            }
            let moves = (lo..=hi).filter(|&k| (fc.y0..fc.y1).any(|y| (fc.x0..fc.x1).any(|x| changed[k][y * g.cw + x]))).count();
            if moves >= cfg.face_moves {
                boxes.push(g.to_cells(&expand_face(f)));
            }
        }
        for b in g.blobs(&long.live(cfg.tile_rate, ml)) {
            if g.touches_edge(&b.rect) && b.rect.area() as f64 <= cfg.tile_max_area * c as f64 {
                // 小窓のふちの升目は、小窓と画面が半分ずつで変わり方が弱く、動き続けているに入らないことがある。1 升目ずつ広げる
                let r = b.rect;
                boxes.push(Cells { x0: r.x0.saturating_sub(1), y0: r.y0.saturating_sub(1), x1: (r.x1 + 1).min(g.cw), y1: (r.y1 + 1).min(g.ch) });
            }
        }
        let mut all = vec![false; c];
        let mut edges = Vec::new();
        for b in boxes {
            g.fill(&mut all, &b);
            if g.touches_edge(&b) {
                edges.push(b);
            } else {
                g.fill(&mut out.center[i - s], &b);
            }
        }
        let cam_area = all.iter().filter(|x| **x).count() as f64 / c as f64;
        out.camera[i - s] = cam_area >= cfg.camera_area || live_cov >= cfg.live_area;
        out.edge.push(edges);
    }
    out
}

/// 秒ごとの「その秒の四角」: 前後 w 秒に見つかった四角（端の四角と、真ん中の動く顔）を合わせたもの
fn local_masks(g: &Grid, b: &CamBoxes, w: usize) -> Vec<Vec<bool>> {
    let (c, len) = (g.n(), b.edge.len());
    let per: Vec<Vec<usize>> = (0..len)
        .map(|k| {
            let mut m = b.center[k].clone();
            for r in &b.edge[k] {
                g.fill(&mut m, r);
            }
            m.iter().enumerate().filter(|(_, x)| **x).map(|(i, _)| i).collect()
        })
        .collect();
    let mut cnt = vec![0u32; c];
    let (mut lo, mut hi) = (0usize, 0usize); // 合わせている秒 [lo, hi)
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let (want_lo, want_hi) = (i.saturating_sub(w), (i + w + 1).min(len));
        while hi < want_hi {
            for &x in &per[hi] {
                cnt[x] += 1;
            }
            hi += 1;
        }
        while lo < want_lo {
            for &x in &per[lo] {
                cnt[x] -= 1;
            }
            lo += 1;
        }
        out.push(cnt.iter().map(|&k| k > 0).collect());
    }
    out
}

// ---- 共有した画面の四角（切り出し。2026-10-13 決定） -----------------------------------------------
//
// 会議アプリの録画では、共有した画面のまわりに参加者の枠（名前・カメラ）や黒い帯が並ぶ（Zoom の「共有画面の横に映像を置く」など）。
// 参加者の名前が全部の絵に写らないよう、共有した画面の部分だけを絵にする。並び方は会議アプリと版と設定で変わるので、それには合わせず、
// 録画そのものから決める。迷ったら切らない（切りすぎると、画面の端のボタンやメニューが消える。名前が残るのは切らないときと同じ）。
//   1. 大きな変化（画面の 15% 以上が同時に変わった秒。スライドや窓の切り替え）の 5% 以上（2 回以上）で一緒に変わり、ふだんの秒の
//      3 倍以上の割合で変わる升目を「共有した画面」とし、それが 1 割以上ある列と行で四角を囲む（会議アプリの枠の話す人の印などは、
//      大きな変化と関係なく変わるか、数升しかない。録画の映り始めのように画面全体が 1 回だけ変わった所も数えない）
//   2. 四角の各辺を外へ広げ、次がそろう所で止める: 内と外の明るさが 16 以上違う所が辺の 6 割以上・外側の 2 本は模様が細かすぎず
//      （0.1 まで。細いので、参加者の名前が境目に接するだけで上がる）動き続けない・外側の地の色が、見本の絵（10 秒ごと）の半分以上で
//      内側の 3 本の 2 割以上を占めることはない（占めていれば、スライドの白い余白などの、共有した画面の中の余白）。
//      変化の少ない画面の端（メニューバーなど）を切らないように、境目まで広げてそろえる
//   3. 切る帯（境目から画面の端まで）も、模様が細かくなく（0.03 まで。文字やアイコンの並ぶメニューは切らない）、動き続けず
//      （秒の半分を超えて変わる所は動画などとみなす。カメラとして塗る所は除く）、地の色が共有した画面でいちばん多い色と違うこと
//      （同じなら、画面いっぱいのスライドの白い余白など。見本の半分以上で見る）。だめなら、さらに外の境目を探す。
//      残すのは画面の 3 割以上・切るのは 2% 以上・1 辺で切るのは幅（高さ）の 45% まで
//   4. 前後 5 分の様子で 1 分ごとに決め直す（並びが途中で変わっても追える）。大きな変化が 3 回に満たず決められない時刻は、
//      いちばん近い時刻の四角を借りる。絵ごとに、切る帯がその 1 枚でも無地に近く、
//      いつもの見た目（前後 5 分の平均）と明るさの差が平均 10 未満かを確かめ、そうでない辺は切らない（並びが変わって中身が入り込んだ）。
//      境目の明るさの差は 1 枚では見ない（実物の録画: 黒に近いメニューバーと黒い帯の境目は、平均では見えるが 1 枚では弱い）
//   5. 四角の外の変化は、画面の変化として数えない（話す人が替わって枠の名前が替わっても、絵を出さない）。
//      場面の切り替わりかどうかは、残す四角に対する大きさで決める（画面全体に対して決めると、共有した画面が小さい並びでは
//      スライドがまるごと替わっても画面の中の変化になり、続けて替えたスライドが「同じ所で続く変化」として 1 枚にまとめられた。
//      実物の録画では絵が 227 → 296 枚になった。増えたのは 5 秒以上表示していた別の画面（表計算のタブなど）で、前は次の画面にまとめられていた）
//   実物の 2 時間半の録画（Zoom・右の 1/4 に参加者の枠・上下に黒い帯）: 枠の帯の模様の細かさは 0.018、共有した画面の端の帯（12 列）は
//   どの絵でも 0.036 以上。境目はすべての秒・すべての行で見えた。四角は 30 分ごとに測っても同じ所

/// 辺
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

/// 左右を先に決める（上下の辺の長さは、決めた左右の間）
const SIDES: [Side; 4] = [Side::Left, Side::Right, Side::Top, Side::Bottom];

/// 模様の細かさを数えるときの、となりとの明るさの差
const TEXTURE_DELTA: f32 = 24.0;

/// 地の色が同じとみなす明るさの差
const SAME_TONE: f32 = 8.0;

/// 小さな升の明るさの絵（横 w・縦 h）
trait Tones {
    fn at(&self, x: usize, y: usize) -> f32;
}

/// 何秒かの平均
struct MeanTones {
    w: usize,
    v: Vec<f32>,
}

impl Tones for MeanTones {
    fn at(&self, x: usize, y: usize) -> f32 {
        self.v[y * self.w + x]
    }
}

/// 1 枚
struct FrameTones<'a> {
    w: usize,
    v: &'a [u8],
}

impl Tones for FrameTones<'_> {
    fn at(&self, x: usize, y: usize) -> f32 {
        self.v[y * self.w + x] as f32
    }
}

impl Side {
    fn vertical(self) -> bool {
        matches!(self, Side::Left | Side::Right)
    }

    /// 辺と直角に並ぶ線の数（縦の辺なら列の数）
    fn lines(self, sw: usize, sh: usize) -> usize {
        if self.vertical() { sw } else { sh }
    }

    /// 切る位置 pos（四角の端。左・上は内側の最初の線、右・下は外側の最初の線）の、内側と外側の最初の線
    fn pair(self, pos: usize) -> (usize, usize) {
        match self {
            Side::Left | Side::Top => (pos, pos - 1),
            Side::Right | Side::Bottom => (pos - 1, pos),
        }
    }

    /// 画面の端に着いた（これ以上広げられない）
    fn at_end(self, pos: usize, n: usize) -> bool {
        match self {
            Side::Left | Side::Top => pos == 0,
            Side::Right | Side::Bottom => pos >= n,
        }
    }

    /// 1 本外へ
    fn outward(self, pos: usize) -> usize {
        match self {
            Side::Left | Side::Top => pos - 1,
            Side::Right | Side::Bottom => pos + 1,
        }
    }

    /// 線 [l0, l1) と、辺に沿った [t0, t1) の四角（小さな升の単位）
    fn band(self, l0: usize, l1: usize, t0: usize, t1: usize) -> Cells {
        if self.vertical() { Cells { x0: l0, y0: t0, x1: l1, y1: t1 } } else { Cells { x0: t0, y0: l0, x1: t1, y1: l1 } }
    }

    /// 位置 pos から外へ k 本（画面の端まで）
    fn outer(self, pos: usize, k: usize, n: usize, t0: usize, t1: usize) -> Cells {
        match self {
            Side::Left | Side::Top => self.band(pos.saturating_sub(k), pos, t0, t1),
            Side::Right | Side::Bottom => self.band(pos, (pos + k).min(n), t0, t1),
        }
    }

    /// 位置 pos から内へ k 本
    fn inner(self, pos: usize, k: usize, n: usize, t0: usize, t1: usize) -> Cells {
        match self {
            Side::Left | Side::Top => self.band(pos, (pos + k).min(n), t0, t1),
            Side::Right | Side::Bottom => self.band(pos.saturating_sub(k), pos, t0, t1),
        }
    }

    /// 四角の、この辺の位置
    fn get(self, c: &Cells) -> usize {
        match self {
            Side::Left => c.x0,
            Side::Right => c.x1,
            Side::Top => c.y0,
            Side::Bottom => c.y1,
        }
    }

    fn set(self, c: &mut Cells, v: usize) {
        match self {
            Side::Left => c.x0 = v,
            Side::Right => c.x1 = v,
            Side::Top => c.y0 = v,
            Side::Bottom => c.y1 = v,
        }
    }

    /// 切っていないときの位置（画面の端）
    fn whole(self, sw: usize, sh: usize) -> usize {
        match self {
            Side::Left | Side::Top => 0,
            Side::Right => sw,
            Side::Bottom => sh,
        }
    }

    /// 切る帯（境目から画面の端まで。縦の辺は上から下まで、横の辺は四角の左右の間）
    fn cut_band(self, c: &Cells, sw: usize, sh: usize) -> Cells {
        let n = self.lines(sw, sh);
        let pos = self.get(c);
        let (t0, t1) = if self.vertical() { (0, sh) } else { (c.x0, c.x1) };
        match self {
            Side::Left | Side::Top => self.band(0, pos, t0, t1),
            Side::Right | Side::Bottom => self.band(pos, n, t0, t1),
        }
    }
}

fn tone_on<T: Tones>(img: &T, side: Side, line: usize, t: usize) -> f32 {
    if side.vertical() { img.at(line, t) } else { img.at(t, line) }
}

/// 境目の内と外で、明るさが delta 以上違う所の割合（辺に沿って [t0, t1)）
fn edge_rate<T: Tones>(img: &T, side: Side, pos: usize, t0: usize, t1: usize, delta: f32) -> f64 {
    if t1 <= t0 {
        return 0.0;
    }
    let (a, b) = side.pair(pos);
    let k = (t0..t1).filter(|&t| (tone_on(img, side, a, t) - tone_on(img, side, b, t)).abs() >= delta).count();
    k as f64 / (t1 - t0) as f64
}

/// 四角の中の模様の細かさ（となりと明るさが 24 以上違う組の割合）
fn texture<T: Tones>(img: &T, r: &Cells) -> f64 {
    let (mut on, mut all) = (0usize, 0usize);
    for y in r.y0..r.y1 {
        for x in r.x0..r.x1 {
            let v = img.at(x, y);
            if x + 1 < r.x1 {
                all += 1;
                on += ((img.at(x + 1, y) - v).abs() >= TEXTURE_DELTA) as usize;
            }
            if y + 1 < r.y1 {
                all += 1;
                on += ((img.at(x, y + 1) - v).abs() >= TEXTURE_DELTA) as usize;
            }
        }
    }
    if all == 0 { 0.0 } else { on as f64 / all as f64 }
}

/// 四角の中でいちばん多い明るさ（4 段ごと）
fn dominant<T: Tones>(img: &T, r: &Cells) -> f32 {
    let mut hist = [0u32; 64];
    for y in r.y0..r.y1 {
        for x in r.x0..r.x1 {
            hist[(img.at(x, y).max(0.0) as usize / 4).min(63)] += 1;
        }
    }
    let k = hist.iter().enumerate().max_by_key(|(_, c)| **c).map_or(0, |(k, _)| k);
    (k * 4) as f32 + 1.5
}

/// 四角の中の、2 つの絵の明るさの差の平均
fn tone_diff<A: Tones, B: Tones>(a: &A, b: &B, r: &Cells) -> f64 {
    let n = r.area();
    if n == 0 {
        return 0.0;
    }
    let s: f64 = (r.y0..r.y1).flat_map(|y| (r.x0..r.x1).map(move |x| (x, y))).map(|(x, y)| (a.at(x, y) - b.at(x, y)).abs() as f64).sum();
    s / n as f64
}

/// 四角の中で、明るさが b から SAME_TONE 以内の小さな升の割合
fn share_of_tone<T: Tones>(img: &T, r: &Cells, b: f32) -> f64 {
    let n = r.area();
    if n == 0 {
        return 0.0;
    }
    let k = (r.y0..r.y1).flat_map(|y| (r.x0..r.x1).map(move |x| (x, y))).filter(|&(x, y)| (img.at(x, y) - b).abs() <= SAME_TONE).count();
    k as f64 / n as f64
}

/// 小さな升の四角を、画面に対する割合に
fn sig_rect(c: &Cells, sw: usize, sh: usize) -> Rect {
    let r4 = |v: f64| (v * 10000.0).round() / 10000.0;
    Rect {
        x: r4(c.x0 as f64 / sw as f64),
        y: r4(c.y0 as f64 / sh as f64),
        w: r4(c.area_w() as f64 / sw as f64),
        h: r4(c.area_h() as f64 / sh as f64),
    }
}

/// 残す四角が小さすぎず、切る所が細すぎない
fn worth_cutting(c: &Cells, sw: usize, sh: usize, cfg: &ScreensConfig) -> bool {
    let kept = c.area() as f64 / (sw * sh) as f64;
    kept >= cfg.crop_keep_min && 1.0 - kept >= cfg.crop_cut_min
}

/// 四角（小さな升の単位）の外にまるごと出ている升目
fn outside_cells(g: &Grid, c: &Cells) -> Vec<bool> {
    (0..g.n())
        .map(|k| {
            let (x, y) = (2 * (k % g.cw), 2 * (k / g.cw));
            x + 2 <= c.x0 || x >= c.x1 || y + 2 <= c.y0 || y >= c.y1
        })
        .collect()
}

/// 前後の秒の数え（升目ごとの、大きな変化の秒・ふだんの秒に変わった回数、小さな升ごとの変わった回数と明るさの合計）
struct CropCount {
    big: Vec<u32>,
    calm: Vec<u32>,
    n_big: u32,
    n_calm: u32,
    /// 小さな升ごとに、変わった秒の数（動き続けるかは、升目でなく小さな升で見る。黒い帯の端の 1 本が、
    /// となりのちらつくメニューバーと同じ升目に入ることがある）
    moves: Vec<u32>,
    tone: Vec<u32>,
    n: u32,
    /// 数えている秒 [lo, hi)
    lo: usize,
    hi: usize,
}

impl CropCount {
    fn new(cells: usize, px: usize, s: usize) -> Self {
        Self { big: vec![0; cells], calm: vec![0; cells], n_big: 0, n_calm: 0, moves: vec![0; px], tone: vec![0; px], n: 0, lo: s, hi: s }
    }

    /// k 秒を足す（add）か引く。k 秒の変化（k-1 → k）は、区間の頭 s のときは区間の外から来るので数えない
    #[allow(clippy::too_many_arguments)]
    fn count(&mut self, k: usize, add: bool, frames: &[ScanFrame], changed: &[Vec<bool>], big: &[bool], s: usize, delta: u8) {
        let step = |v: &mut u32, by: u32| *v = if add { *v + by } else { *v - by };
        for (t, v) in self.tone.iter_mut().zip(&frames[k].sig) {
            step(t, *v as u32);
        }
        step(&mut self.n, 1);
        if k > s {
            let b = big[k - s];
            let to = if b { &mut self.big } else { &mut self.calm };
            for (t, ch) in to.iter_mut().zip(&changed[k]) {
                step(t, *ch as u32);
            }
            step(if b { &mut self.n_big } else { &mut self.n_calm }, 1);
            for ((m, a), b) in self.moves.iter_mut().zip(&frames[k - 1].sig).zip(&frames[k].sig) {
                step(m, (a.abs_diff(*b) >= delta) as u32);
            }
        }
    }

    /// 数える秒を [lo, hi) に動かす（前へだけ動く）
    #[allow(clippy::too_many_arguments)]
    fn move_to(&mut self, lo: usize, hi: usize, frames: &[ScanFrame], changed: &[Vec<bool>], big: &[bool], s: usize, delta: u8) {
        while self.hi < hi {
            self.count(self.hi, true, frames, changed, big, s, delta);
            self.hi += 1;
        }
        while self.lo < lo {
            self.count(self.lo, false, frames, changed, big, s, delta);
            self.lo += 1;
        }
    }
}

/// 数えている秒の様子から、共有した画面の四角（小さな升の単位）を決める。決められない・切るほどでないときは None。
/// 四角と一緒に、数えた秒の平均の絵を返す（絵ごとの確かめで、切る帯のいつもの見た目に使う）。
/// cam は区間のあいだ塗るカメラの四角（升目。動き続けてよく、共有した画面とはみなさない）
fn decide_crop(cnt: &CropCount, frames: &[ScanFrame], g: &Grid, sw: usize, sh: usize, cam: &[bool], cfg: &ScreensConfig) -> Option<(Cells, MeanTones)> {
    if cnt.n == 0 || (cnt.n_big as usize) < cfg.crop_min_big.max(1) {
        return None;
    }
    let (n_big, n_calm, n_all) = (cnt.n_big as f64, cnt.n_calm.max(1) as f64, (cnt.n_big + cnt.n_calm).max(1) as f64);
    // 1. 共有した画面の升目と、それを囲む四角（小さな升の単位）。大きな変化に 1 回だけ加わった所は数えない
    //    （録画の映り始めなど、画面全体が一度に変わることがある）
    let content: Vec<bool> = (0..g.n())
        .map(|c| {
            let p = cnt.big[c] as f64 / n_big;
            !cam[c] && cnt.big[c] >= 2 && p >= cfg.crop_part && p >= cfg.crop_lift * (cnt.calm[c] as f64 / n_calm)
        })
        .collect();
    //    囲むのは、共有した画面の升目が crop_line_part 以上ある列と行だけ（参加者の枠の、話している印などの数升で四角を広げない。
    //    実物の録画: 名前のあたりの数升が、スライドの切り替えと同じころに何度も変わった）
    //    列は決めた行の間で、行は決めた列の間で数え、2 回くり返して絞る（升目の単位）
    let part = |n: usize, of: usize| of > 0 && n as f64 >= cfg.crop_line_part * of as f64;
    let mut b = Cells { x0: 0, y0: 0, x1: g.cw, y1: g.ch };
    for _ in 0..2 {
        let cols: Vec<usize> = (0..g.cw).filter(|&x| part((b.y0..b.y1).filter(|&y| content[y * g.cw + x]).count(), b.area_h())).collect();
        let (&x0, &x1) = (cols.first()?, cols.last()?);
        (b.x0, b.x1) = (x0, x1 + 1);
        let rows: Vec<usize> = (0..g.ch).filter(|&y| part((b.x0..b.x1).filter(|&x| content[y * g.cw + x]).count(), b.area_w())).collect();
        let (&y0, &y1) = (rows.first()?, rows.last()?);
        (b.y0, b.y1) = (y0, y1 + 1);
    }
    let bbox = Cells { x0: 2 * b.x0, y0: 2 * b.y0, x1: 2 * b.x1, y1: 2 * b.y1 };
    // 動き続けない（カメラとして塗る所は、動き続けてよい）
    let all_quiet = |r: &Cells| {
        (r.y0..r.y1).all(|y| {
            (r.x0..r.x1).all(|x| {
                let (cx, cy) = (x / 2, y / 2);
                (cx < g.cw && cy < g.ch && cam[cy * g.cw + cx]) || cnt.moves[y * sw + x] as f64 / n_all <= cfg.crop_quiet
            })
        })
    };
    let mean = MeanTones { w: sw, v: cnt.tone.iter().map(|&t| t as f32 / cnt.n as f32).collect() };
    // 外の地の色が内側に続くかは、平均でなく 1 枚ずつ見る（平均では、白い余白と動く中身が混ざって別の色になる）。
    // 見本の半分以上で続くときだけ余白とみなす（共有した画面が一瞬真っ黒になった 1 枚で、黒い帯の境目を捨てないように）
    let samples: Vec<FrameTones> = (cnt.lo..cnt.hi).step_by(10).map(|k| FrameTones { w: sw, v: &frames[k].sig }).collect();
    let boundary = |side: Side, pos: usize, t0: usize, t1: usize| -> bool {
        let n = side.lines(sw, sh);
        if edge_rate(&mean, side, pos, t0, t1, cfg.crop_edge as f32) < cfg.crop_edge_rate {
            return false;
        }
        let outer = side.outer(pos, 2, n, t0, t1);
        if texture(&mean, &outer) > cfg.crop_edge_texture || !all_quiet(&outer) {
            return false;
        }
        let inner = side.inner(pos, 3, n, t0, t1);
        let margin = samples.iter().filter(|f| share_of_tone(*f, &inner, dominant(*f, &outer)) >= cfg.crop_continue).count();
        2 * margin < samples.len()
    };
    // 2〜3. 辺ごとに、境目まで外へ広げ、そこから画面の端までの帯を確かめる。帯がだめなら（共有した画面の中の境目だった）、
    // さらに外の境目を探す。升目の四角は小さな升 1 本ぶんはみ出しうるので、1 本内側から探す
    let mut crop = Cells { x0: 0, y0: 0, x1: sw, y1: sh };
    for side in SIDES {
        let n = side.lines(sw, sh);
        let (t0, t1) = if side.vertical() { (bbox.y0, bbox.y1) } else { (crop.x0, crop.x1) };
        let (lo, hi) = if side.vertical() { (bbox.x0, bbox.x1) } else { (bbox.y0, bbox.y1) };
        let mut pos = match side {
            Side::Left | Side::Top if lo + 1 < hi => lo + 1,
            Side::Left | Side::Top => lo,
            Side::Right | Side::Bottom if hi > lo + 1 => hi - 1,
            Side::Right | Side::Bottom => hi,
        };
        while !side.at_end(pos, n) {
            if boundary(side, pos, t0, t1) {
                let mut trial = crop;
                side.set(&mut trial, pos);
                let band = side.cut_band(&trial, sw, sh);
                let depth = if side.vertical() { band.area_w() } else { band.area_h() };
                // 帯の地の色が、共有した画面でいちばん多い色と同じなら、共有した画面の余白（画面いっぱいのスライドの白い余白など）。
                // 見本の半分以上で同じなら切らない
                let same_ground = samples.iter().filter(|f| (dominant(*f, &band) - dominant(*f, &bbox)).abs() <= SAME_TONE).count();
                if depth as f64 <= cfg.crop_side_max * n as f64
                    && texture(&mean, &band) <= cfg.crop_texture
                    && all_quiet(&band)
                    && 2 * same_ground < samples.len()
                {
                    crop = trial;
                    break;
                }
            }
            pos = side.outward(pos);
        }
    }
    worth_cutting(&crop, sw, sh, cfg).then_some((crop, mean))
}

/// 決めた四角が、この 1 枚でも成り立つか（切る辺ごとに、切る帯の模様が細かくなく、いつもの見た目 usual と変わらない）。
/// 成り立たない辺は切らない
fn crop_for_frame(crop: &Cells, usual: &MeanTones, f: &ScanFrame, sw: usize, sh: usize, cfg: &ScreensConfig) -> Option<Cells> {
    let img = FrameTones { w: sw, v: &f.sig };
    let mut c = *crop;
    for side in SIDES {
        if side.get(&c) == side.whole(sw, sh) {
            continue;
        }
        let band = side.cut_band(&c, sw, sh);
        if texture(&img, &band) > cfg.crop_texture || tone_diff(&img, usual, &band) >= cfg.crop_same {
            side.set(&mut c, side.whole(sw, sh));
        }
    }
    worth_cutting(&c, sw, sh, cfg).then_some(c)
}

/// 共有の区間の切り出し（crop_step_sec ごとに決めた四角と、そのときの平均の絵）
struct SegCrop {
    s: usize,
    step: usize,
    crops: Vec<Option<(Cells, MeanTones)>>,
    /// 四角の外にまるごと出ている升目（画面の変化として数えない）。切らない時刻は空
    outside: Vec<Vec<bool>>,
}

impl SegCrop {
    fn index(&self, i: usize) -> Option<usize> {
        (!self.crops.is_empty()).then(|| ((i.saturating_sub(self.s) + self.step / 2) / self.step).min(self.crops.len() - 1))
    }

    /// i 秒の四角（小さな升の単位）と、切る帯のいつもの見た目。i 秒のまわりで決められなかったとき（大きな変化が少ない）は、
    /// いちばん近い時刻の四角を借りる（絵ごとの確かめで、切る帯がいつもの見た目でなければ切らない）
    fn at(&self, i: usize) -> Option<(&Cells, &MeanTones)> {
        let k = self.index(i)?;
        let n = self.crops.len();
        (0..n)
            .flat_map(|d| [k.checked_sub(d), (d > 0 && k + d < n).then_some(k + d)])
            .flatten()
            .find_map(|j| self.crops[j].as_ref())
            .map(|(c, m)| (c, m))
    }

    /// i 秒に、画面の変化として数えない升目
    fn outside_at(&self, i: usize) -> Option<&[bool]> {
        self.index(i).map(|k| self.outside[k].as_slice()).filter(|o| !o.is_empty())
    }
}

/// 共有の区間 [s, e] の切り出しを決める（cam は区間のあいだ塗るカメラの四角）
#[allow(clippy::too_many_arguments)]
fn seg_crop(g: &Grid, frames: &[ScanFrame], changed: &[Vec<bool>], cam: &[bool], cfg: &ScreensConfig, sw: usize, sh: usize, s: usize, e: usize) -> SegCrop {
    let step = cfg.crop_step_sec.max(1);
    if !cfg.crop || sw < 4 || sh < 4 {
        return SegCrop { s, step, crops: Vec::new(), outside: Vec::new() };
    }
    let c = g.n();
    let big: Vec<bool> = (s..=e)
        .map(|k| k > s && changed[k].iter().zip(cam).filter(|(ch, m)| **ch && !**m).count() as f64 >= cfg.crop_big * c as f64)
        .collect();
    let w = cfg.crop_window_sec;
    let mut cnt = CropCount::new(c, sw * sh, s);
    let mut crops = Vec::new();
    let mut center = s;
    while center <= e {
        cnt.move_to(center.saturating_sub(w).max(s), (center + w).min(e) + 1, frames, changed, &big, s, cfg.cell_delta);
        crops.push(decide_crop(&cnt, frames, g, sw, sh, cam, cfg));
        center += step;
    }
    let outside = crops.iter().map(|cr| cr.as_ref().map(|(r, _)| outside_cells(g, r)).unwrap_or_default()).collect();
    SegCrop { s, step, crops, outside }
}

/// 録画全体に対する四角 r を、切り出した絵 crop に対する四角にする（絵の外は切る。絵に入らなければ None）
pub fn in_image(r: &Rect, crop: &Rect) -> Option<Rect> {
    if crop.w <= 0.0 || crop.h <= 0.0 {
        return None;
    }
    let r4 = |v: f64| (v * 10000.0).round() / 10000.0;
    let x0 = ((r.x - crop.x) / crop.w).clamp(0.0, 1.0);
    let y0 = ((r.y - crop.y) / crop.h).clamp(0.0, 1.0);
    let x1 = ((r.x + r.w - crop.x) / crop.w).clamp(0.0, 1.0);
    let y1 = ((r.y + r.h - crop.y) / crop.h).clamp(0.0, 1.0);
    (x1 > x0 && y1 > y0).then(|| Rect { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) })
}

/// 絵に合わせた区間（変わった所と塗る四角を、切り出した絵に対する割合にする。zip の timeline 用）
pub fn in_image_span(s: &Span) -> Span {
    let mut out = s.clone();
    if let Some(c) = s.crop {
        out.changed = s.changed.and_then(|r| in_image(&r, &c));
        out.masks = s.masks.iter().filter_map(|m| in_image(m, &c)).collect();
    }
    out
}

/// 読み取りの結果から区間を決める
pub fn analyze(scan: &Scan, cfg: &ScreensConfig) -> Screens {
    let frames: Vec<ScanFrame> = scan.frames.iter().filter(|f| f.sig.len() == scan.sig_w * scan.sig_h).cloned().collect();
    let duration = frames.last().map_or(0.0, |f| f.t + 1.0);
    let g = Grid::new(scan.sig_w, scan.sig_h);
    let empty = |duration: f64| Screens {
        version: SCREENS_VERSION,
        video_w: scan.video_w,
        video_h: scan.video_h,
        duration_sec: duration,
        spans: Vec::new(),
        summary: Summary::default(),
    };
    let (n, c) = (frames.len(), g.n());
    if n == 0 || c == 0 {
        return empty(duration);
    }

    // 1. 升目ごとに、1 秒前から変わったか
    let mut changed = vec![vec![false; c]; n];
    for i in 1..n {
        let (a, b) = (&frames[i - 1].sig, &frames[i].sig);
        g.changed(a, b, cfg.cell_delta, &mut changed[i]);
    }

    // 2. カメラの時間らしいか（録画全体で、動いている顔・動き続けている所を見る）
    let whole = camera_boxes(&g, &frames, &changed, cfg, 0, n - 1);

    // 3. カメラの時間と共有の時間（短い入れ替わりはならす）
    let camera = smooth(&whole.camera, cfg.switch_sec.max(1));
    let mut center = vec![vec![false; c]; n];
    let mut runs: Vec<(bool, usize, usize)> = Vec::new(); // (カメラか, 始まり, 終わり)
    let mut i = 0;
    while i < n {
        let mut j = i;
        while j + 1 < n && camera[j + 1] == camera[i] {
            j += 1;
        }
        runs.push((camera[i], i, j));
        i = j + 1;
    }
    let mut pieces: Vec<Piece> = Vec::new();
    let mut seg_masks: Vec<Vec<bool>> = Vec::new();
    let mut seg_crops: Vec<SegCrop> = Vec::new();
    for r in 0..runs.len() {
        let (cam, s, e) = runs[r];
        if cam {
            continue;
        }
        // カメラの四角は、この共有の区間の中の動きだけで決め直す（となりのカメラの時間の動きを数えないように）。
        // 端に接した四角は、区間のあいだずっと塗る
        let mask_of = |b: &CamBoxes| {
            let mut m = vec![false; c];
            for r in b.edge.iter().flatten() {
                g.fill(&mut m, r);
            }
            m
        };
        let b0 = camera_boxes(&g, &frames, &changed, cfg, s, e);
        let mask0 = mask_of(&b0);
        // 動き続けるかを前後の秒で見るので、カメラの時間が共有の画面に数秒はみ出す。
        // 同じ画面が続く所まで、共有の区間を広げる（となりのカメラの時間は 1 秒は残す）
        let quiet = |k: usize| changed[k].iter().zip(&mask0).all(|(ch, m)| !*ch || *m);
        let floor = if r > 0 { runs[r - 1].1 + 1 } else { 0 };
        let ceil = if r + 1 < runs.len() { runs[r + 1].2.saturating_sub(1) } else { n - 1 };
        let (mut s2, mut e2) = (s, e);
        while s2 > floor && quiet(s2) {
            s2 -= 1;
        }
        while e2 < ceil && quiet(e2 + 1) {
            e2 += 1;
        }
        let b = if (s2, e2) == (s, e) { b0 } else { camera_boxes(&g, &frames, &changed, cfg, s2, e2) };
        // 常駐する端の四角（区間の persist_rate 以上の秒で見つかった升目）は区間のあいだずっと塗り、
        // ほかの四角は見つかった秒の前後 window_sec 秒だけ塗る
        let len = e2 + 1 - s2;
        let mut cover = vec![0u32; c];
        for boxes in &b.edge {
            let mut seen = vec![false; c];
            for r in boxes {
                g.fill(&mut seen, r);
            }
            for (k, x) in seen.iter().enumerate() {
                cover[k] += *x as u32;
            }
        }
        let mask: Vec<bool> = cover.iter().map(|&k| k > 0 && k as f64 >= cfg.persist_rate * len as f64).collect();
        for (k, m) in local_masks(&g, &b, cfg.window_sec).into_iter().enumerate() {
            center[s2 + k] = m;
        }
        runs[r] = (false, s2, e2);
        if r > 0 {
            runs[r - 1].2 = s2 - 1;
        }
        if r + 1 < runs.len() {
            runs[r + 1].1 = e2 + 1;
        }
        // 4. 共有した画面の四角（切り出し）を決め、共有の区間を状態に区切る（四角の外の変化は数えない）
        let crop = seg_crop(&g, &frames, &changed, &mask, cfg, scan.sig_w, scan.sig_h, s2, e2);
        let (seg_pieces, seg_mask) = {
            let mut run = SegRun { g: &g, cfg, frames: &frames, center: &center, mask, calm: vec![None; n], seg: seg_masks.len(), crop: &crop };
            let p = run.run(s2, e2);
            (p, run.mask)
        };
        pieces.extend(seg_pieces);
        seg_masks.push(seg_mask);
        seg_crops.push(crop);
    }
    pieces.extend(runs.iter().filter(|r| r.0).map(|r| Piece::Camera { start: r.1 }));
    pieces.sort_by_key(|p| p.start());

    // 5. 区間の終わり・絵の時刻・黒く塗る四角
    let end_of = |k: usize| pieces.get(k + 1).map_or(n - 1, |p| p.start() - 1);
    let t_end = |idx: usize| if idx + 1 < n { frames[idx + 1].t } else { duration };
    let export_mask = |seg: usize, at: usize| -> Vec<bool> { seg_masks[seg].iter().zip(&center[at]).map(|(a, b)| *a || *b).collect() };
    // 絵にする四角（その 1 枚でも成り立つ辺だけ。小さな升の単位）
    let (sw, sh) = (scan.sig_w, scan.sig_h);
    let crop_of = |seg: usize, at: usize| seg_crops[seg].at(at).and_then(|(c, usual)| crop_for_frame(c, usual, &frames[at], sw, sh, cfg));
    let mut spans: Vec<Span> = Vec::new();
    // 状態ごとの（区間の番号, 絵の升目の番号, 塗る所）
    let mut states: Vec<(usize, usize, Vec<bool>, usize)> = Vec::new();
    for (k, p) in pieces.iter().enumerate() {
        let (start, end) = (p.start(), end_of(k));
        let mut span = Span {
            id: spans.len() + 1,
            kind: SpanKind::Camera,
            start: frames[start].t,
            end: t_end(end),
            frame_t: None,
            frame: None,
            same_as: None,
            transient: false,
            changed: None,
            crop: None,
            masks: Vec::new(),
            faces: false,
        };
        let rep = match p {
            Piece::Camera { .. } => None,
            Piece::State { last, kind, changed, seg, .. } => {
                span.kind = *kind;
                span.changed = changed.as_ref().map(|r| g.to_rect(r));
                // 「前と同じ画面」を比べるときは、切り出した四角の外も見ない
                let mut m = export_mask(*seg, *last);
                if let Some(c) = crop_of(*seg, *last) {
                    for (a, o) in m.iter_mut().zip(outside_cells(&g, &c)) {
                        *a = *a || o;
                    }
                }
                states.push((spans.len(), *last, m, *seg));
                Some((*last, *seg))
            }
            Piece::Busy { start, end, seg } => {
                span.kind = SpanKind::Busy;
                let mid = (start + end) / 2;
                Some((mid, *seg))
            }
        };
        if let Some((at, seg)) = rep {
            let m = export_mask(seg, at);
            let crop = crop_of(seg, at).map(|c| sig_rect(&c, sw, sh));
            // 絵の外になる塗る四角・顔は数えない
            let in_shot = |r: &Rect| crop.map_or(true, |c| in_image(r, &c).is_some());
            span.frame_t = Some(frames[at].t);
            span.crop = crop;
            span.masks = g.rects(&m).into_iter().filter(|r| in_shot(r)).collect();
            span.faces = frames[at].faces.iter().any(|f| {
                let fc = g.to_cells(f);
                fc.area() > 0 && g.covered(&m, &fc) < fc.area() && in_shot(f)
            });
        }
        spans.push(span);
    }

    // 6. 前と同じ画面・一時的な表示
    let same = |a: &(usize, usize, Vec<bool>, usize), b: &(usize, usize, Vec<bool>, usize)| -> bool {
        let mut on = vec![false; c];
        g.changed(&frames[a.1].sig, &frames[b.1].sig, cfg.cell_delta, &mut on);
        let mut raw = 0;
        for k in 0..c {
            on[k] = on[k] && !a.2[k] && !b.2[k];
            raw += on[k] as usize;
        }
        if raw as f64 > 0.25 * c as f64 {
            return false;
        }
        let left: usize = g.blobs(&on).iter().filter(|bl| bl.cells.len() > cfg.small_blob).map(|bl| bl.cells.len()).sum();
        left < cfg.state_cells
    };
    for s in 1..states.len() {
        if let Some(t) = (0..s).find(|&t| spans[states[t].0].same_as.is_none() && same(&states[s], &states[t])) {
            let id = spans[states[t].0].id;
            spans[states[s].0].same_as = Some(id);
        }
    }
    let root = |spans: &[Span], k: usize| spans[k].same_as.unwrap_or(spans[k].id);
    for s in 1..states.len().saturating_sub(1) {
        let (a, b, cc) = (states[s - 1].0, states[s].0, states[s + 1].0);
        // 同じ共有の区間で、間に動きの多い時間などを挟まない並び
        let tight = b == a + 1 && cc == b + 1 && states[s - 1].3 == states[s].3 && states[s].3 == states[s + 1].3;
        if tight && spans[b].end - spans[b].start < cfg.transient_sec && root(&spans, a) == root(&spans, cc) {
            spans[b].transient = true;
        }
    }

    // 7. 絵を間引く（区間をまとめる。時間はまとめた先の区間に入るので、発言は消えない）
    let mut spans = thin(spans, cfg);

    // 8. 絵のファイルの名前と、数のまとめ
    let mut summary = Summary::default();
    for s in &mut spans {
        let exported = s.frame_t.is_some() && s.same_as.is_none() && !s.transient;
        if exported {
            summary.frames += 1;
            s.frame = Some(format!("frames/{:04}.jpg", summary.frames));
            summary.faces += s.faces as usize;
            summary.cropped += s.crop.is_some() as usize;
            match s.kind {
                SpanKind::Scene => summary.scenes += 1,
                SpanKind::Step => summary.steps += 1,
                _ => {}
            }
        } else {
            s.frame_t = None;
            s.masks.clear();
            s.faces = false;
            s.crop = None;
        }
        let len = s.end - s.start;
        if s.kind == SpanKind::Camera {
            summary.camera_sec += len;
        } else {
            summary.share_sec += len;
        }
    }
    summary.share_sec = (summary.share_sec * 10.0).round() / 10.0;
    summary.camera_sec = (summary.camera_sec * 10.0).round() / 10.0;
    Screens { version: SCREENS_VERSION, video_w: scan.video_w, video_h: scan.video_h, duration_sec: duration, spans, summary }
}

/// 変わった所どうしの重なり（小さいほうの広さに対する割合）
fn overlap(a: &Rect, b: &Rect) -> f64 {
    let ox = ((a.x + a.w).min(b.x + b.w) - a.x.max(b.x)).max(0.0);
    let oy = ((a.y + a.h).min(b.y + b.h) - a.y.max(b.y)).max(0.0);
    let small = (a.w * a.h).min(b.w * b.h);
    if small > 0.0 { ox * oy / small } else { 0.0 }
}

/// 絵を間引く: 区間をまとめ、番号を振り直す（「前と同じ」の番号も付け替える）。
/// まとめるのは共有の時間の中だけ（カメラの時間とはまとめない）。「前と同じ」・一時的な表示・それらが指す区間はまとめない
fn thin(spans: Vec<Span>, cfg: &ScreensConfig) -> Vec<Span> {
    let total_end = spans.last().map_or(0.0, |s| s.end);
    let referenced: std::collections::HashSet<usize> = spans.iter().filter_map(|s| s.same_as).collect();
    let image = |s: &Span| s.frame_t.is_some() && s.same_as.is_none() && !s.transient;
    let droppable = |s: &Span| {
        image(s)
            && !referenced.contains(&s.id)
            && ((cfg.drop_busy && s.kind == SpanKind::Busy) || (s.kind == SpanKind::Step && s.end - s.start < cfg.min_step_sec))
    };
    let mut out: Vec<Span> = Vec::new();
    // 古い番号 → まとめた先（out の位置）
    let mut moved: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    // 次の区間にまとめるのを待っている区間（古い番号）と、その始まり
    let mut pending: Vec<usize> = Vec::new();
    let mut pending_start = 0.0;
    for mut sp in spans {
        let camera = sp.kind == SpanKind::Camera;
        if !camera && droppable(&sp) {
            if pending.is_empty() {
                pending_start = sp.start;
            }
            pending.push(sp.id);
            continue;
        }
        let mut absorbed = false;
        if !pending.is_empty() {
            match out.last() {
                // カメラの時間の前で待っている区間は、前の共有の区間にまとめる（終わりはあとで次の始まりにそろえる）
                Some(last) if camera && last.kind != SpanKind::Camera => {
                    let at = out.len() - 1;
                    pending.drain(..).for_each(|id| {
                        moved.insert(id, at);
                    });
                }
                // それ以外は、この区間にまとめる（始まりを前へ）
                _ => {
                    sp.start = pending_start;
                    absorbed = true;
                    let at = out.len();
                    pending.drain(..).for_each(|id| {
                        moved.insert(id, at);
                    });
                }
            }
        }
        // 同じ所で続く画面の中の変化は、最後の 1 枚に（間に何もはさまないときだけ）
        let same_place = !absorbed
            && cfg.merge_overlap > 0.0
            && sp.kind == SpanKind::Step
            && image(&sp)
            && out.last().is_some_and(|last| {
                last.kind == SpanKind::Step
                    && image(last)
                    && !referenced.contains(&last.id)
                    && matches!((&last.changed, &sp.changed), (Some(a), Some(b)) if overlap(a, b) >= cfg.merge_overlap)
            });
        if same_place {
            // 前の区間の位置にこの区間を置き直すので、前の区間にまとめた番号はそのまま
            let last = out.pop().unwrap();
            let (a, b) = (last.changed.unwrap(), sp.changed.unwrap());
            let (x0, y0) = (a.x.min(b.x), a.y.min(b.y));
            let (x1, y1) = ((a.x + a.w).max(b.x + b.w), (a.y + a.h).max(b.y + b.h));
            let r4 = |v: f64| (v * 10000.0).round() / 10000.0;
            sp.changed = Some(Rect { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) });
            sp.start = last.start;
        }
        moved.insert(sp.id, out.len());
        out.push(sp);
    }
    // 最後に待っている区間は、前の区間にまとめる
    if !pending.is_empty() && !out.is_empty() {
        let at = out.len() - 1;
        pending.drain(..).for_each(|id| {
            moved.insert(id, at);
        });
    }
    // 終わりを次の区間の始まりにそろえ（区間はすき間なく並ぶ）、番号を振り直す
    for k in 0..out.len() {
        out[k].end = if k + 1 < out.len() { out[k + 1].start } else { total_end };
        out[k].id = k + 1;
    }
    for s in &mut out {
        if let Some(old) = s.same_as {
            s.same_as = moved.get(&old).map(|p| p + 1);
        }
    }
    out
}

// ---- zip に入れる timeline -----------------------------------------------------------------

/// 区間ごとの発言の番号（発言の真ん中の時刻が入っている区間に 1 回だけ）
pub fn assign(spans: &[Span], utts: &[Utterance]) -> Vec<Vec<usize>> {
    let mut out = vec![Vec::new(); spans.len()];
    if spans.is_empty() {
        return out;
    }
    for (k, u) in utts.iter().enumerate() {
        let mid = (u.start + u.end) / 2.0;
        let idx = spans.partition_point(|s| s.start <= mid).saturating_sub(1);
        out[idx].push(k);
    }
    out
}

fn who(lang: Lang, s: &str) -> String {
    match (lang, s == UNKNOWN) {
        (Lang::Ja, true) => "確認用".into(),
        (Lang::En, true) => "Unassigned".into(),
        _ => crate::lang::speaker(lang, s).into_owned(),
    }
}

/// 長さ（「2分28秒」「1時間2分」／"2 min 28 s"）
fn fmt_len(sec: f64, lang: Lang) -> String {
    let t = sec.max(0.0).round() as u64;
    let (h, m, s) = (t / 3600, (t % 3600) / 60, t % 60);
    match lang {
        Lang::Ja if h > 0 => format!("{h}時間{m}分"),
        Lang::Ja if m > 0 => format!("{m}分{s}秒"),
        Lang::Ja => format!("{s}秒"),
        Lang::En if h > 0 => format!("{h} h {m} min"),
        Lang::En if m > 0 => format!("{m} min {s} s"),
        Lang::En => format!("{s} s"),
    }
}

/// 画面の中の位置（左上・上・右上…）
fn place(r: &Rect, lang: Lang) -> String {
    let col = |v: f64| if v < 1.0 / 3.0 { 0 } else if v < 2.0 / 3.0 { 1 } else { 2 };
    let (cx, cy) = (col(r.x + r.w / 2.0), col(r.y + r.h / 2.0));
    let ja = [["左上", "上", "右上"], ["左", "真ん中", "右"], ["左下", "下", "右下"]];
    let en = [["top left", "top", "top right"], ["left", "center", "right"], ["bottom left", "bottom", "bottom right"]];
    let pct = |v: f64| (v * 100.0).round() as i64;
    match lang {
        Lang::Ja => format!(
            "{}（左から {}〜{}%・上から {}〜{}%）",
            ja[cy][cx],
            pct(r.x),
            pct(r.x + r.w),
            pct(r.y),
            pct(r.y + r.h)
        ),
        Lang::En => format!(
            "{} ({}–{}% from the left, {}–{}% from the top)",
            en[cy][cx],
            pct(r.x),
            pct(r.x + r.w),
            pct(r.y),
            pct(r.y + r.h)
        ),
    }
}

/// 区間の見出しの下の一行（表示していた時間・発言の数・話者ごとの数）
fn talk_line(s: &Span, us: &[&Utterance], lang: Lang) -> String {
    let mut by: Vec<(String, usize)> = Vec::new();
    for u in us {
        let name = who(lang, &u.speaker);
        match by.iter_mut().find(|(n, _)| *n == name) {
            Some((_, k)) => *k += 1,
            None => by.push((name, 1)),
        }
    }
    by.sort_by(|a, b| b.1.cmp(&a.1));
    let len = fmt_len(s.end - s.start, lang);
    match lang {
        Lang::Ja => {
            let who = if by.is_empty() {
                String::new()
            } else {
                format!("（{}）", by.iter().map(|(n, k)| format!("{n} {k}")).collect::<Vec<_>>().join("・"))
            };
            let head = if s.kind == SpanKind::Camera { "長さ" } else { "表示していた時間" };
            format!("{head} {len}・発言 {}{who}", us.len())
        }
        Lang::En => {
            let who = if by.is_empty() {
                String::new()
            } else {
                format!(" ({})", by.iter().map(|(n, k)| format!("{n} {k}")).collect::<Vec<_>>().join(", "))
            };
            let head = if s.kind == SpanKind::Camera { "Length" } else { "On screen for" };
            format!("{head} {len} · {} remarks{who}", us.len())
        }
    }
}

/// timeline.md（区間ごとの絵と、その間の発言）
pub fn timeline_md(sc: &Screens, utts: &[Utterance], title: &str, lang: Lang) -> String {
    let long_form = sc.duration_sec >= 3600.0;
    let ts = |v: f64| merge::fmt_ts(v, long_form);
    let groups = assign(&sc.spans, utts);
    let frame_of = |id: usize| sc.spans.iter().find(|s| s.id == id).and_then(|s| s.frame.clone());
    let sm = &sc.summary;
    let mut out = Vec::new();
    match lang {
        Lang::Ja => {
            out.push(format!("# 画面と発言の流れ：{title}"));
            out.push(String::new());
            out.push(format!("- 録画の長さ：{}", fmt_len(sc.duration_sec, lang)));
            out.push(format!(
                "- 場面の切り替わり {}・画面の中の変化 {}・絵 {} 枚{}",
                sm.scenes,
                sm.steps,
                sm.frames,
                if sm.faces > 0 { format!("（顔が写っているかもしれない絵 {} 枚）", sm.faces) } else { String::new() }
            ));
            if sm.cropped > 0 {
                out.push(format!(
                    "- 絵 {} 枚は、共有していた画面の部分だけを切り出しています（会議アプリの参加者の枠などを外しました）。「変わった所」の位置は、絵に対する位置です",
                    sm.cropped
                ));
            }
            out.push("- 時刻は録画の頭からの経過です。区間の読み方は README.md にあります".into());
        }
        Lang::En => {
            out.push(format!("# Screens and remarks: {title}"));
            out.push(String::new());
            out.push(format!("- Recording length: {}", fmt_len(sc.duration_sec, lang)));
            out.push(format!(
                "- {} scene changes · {} changes within a screen · {} images{}",
                sm.scenes,
                sm.steps,
                sm.frames,
                if sm.faces > 0 { format!(" ({} may show a face)", sm.faces) } else { String::new() }
            ));
            if sm.cropped > 0 {
                out.push(format!(
                    "- {} images show only the shared screen (the meeting app's participant panel and borders were cut off). Positions in \"What changed\" are relative to the image",
                    sm.cropped
                ));
            }
            out.push("- Times are from the start of the recording. README.md explains how to read the sections".into());
        }
    }
    // 変わった所は、切り出した絵に対する位置で書く
    let shown: Vec<Span> = sc.spans.iter().map(in_image_span).collect();
    for (s, g) in shown.iter().zip(&groups) {
        let us: Vec<&Utterance> = g.iter().map(|&k| &utts[k]).collect();
        let level = if matches!(s.kind, SpanKind::Scene | SpanKind::Camera) { "##" } else { "###" };
        let range = format!("{}〜{}", ts(s.start), ts(s.end));
        let name = match (lang, s.kind, s.same_as.is_some(), s.transient) {
            (Lang::Ja, _, _, true) => "一時的な表示",
            (Lang::Ja, _, true, _) => "前と同じ画面",
            (Lang::Ja, SpanKind::Scene, ..) => "場面の切り替わり",
            (Lang::Ja, SpanKind::Step, ..) => "画面の中の変化",
            (Lang::Ja, SpanKind::Busy, ..) => "動きの多い時間",
            (Lang::Ja, SpanKind::Camera, ..) => "カメラの時間",
            (Lang::En, _, _, true) => "Brief display",
            (Lang::En, _, true, _) => "Same screen as before",
            (Lang::En, SpanKind::Scene, ..) => "Scene change",
            (Lang::En, SpanKind::Step, ..) => "Change within the screen",
            (Lang::En, SpanKind::Busy, ..) => "Busy period",
            (Lang::En, SpanKind::Camera, ..) => "Camera only",
        };
        out.push(String::new());
        out.push(match lang {
            Lang::Ja => format!("{level} {}. {name}［{range}］", s.id),
            Lang::En => format!("{level} {}. {name} [{}–{}]", s.id, ts(s.start), ts(s.end)),
        });
        out.push(String::new());
        out.push(talk_line(s, &us, lang));
        let note = match (lang, s.kind, s.same_as, s.transient) {
            (Lang::Ja, _, _, true) => Some("すぐ元の画面に戻った表示です（通知など）。中身を出さないよう、絵は入れていません".to_string()),
            (Lang::En, _, _, true) => Some("A display that went away within seconds (such as a notification). No image, so its content is not shown".to_string()),
            (Lang::Ja, _, Some(id), _) => Some(match frame_of(id) {
                Some(f) => format!("{id} と同じ画面です。絵は {id} のもの（`{f}`）を見てください"),
                None => format!("{id} と同じ画面です"),
            }),
            (Lang::En, _, Some(id), _) => Some(match frame_of(id) {
                Some(f) => format!("Same screen as {id}. See the image of {id} (`{f}`)"),
                None => format!("Same screen as {id}"),
            }),
            (Lang::Ja, SpanKind::Step, ..) => s.changed.as_ref().map(|r| format!("変わった所：{}", place(r, lang))),
            (Lang::En, SpanKind::Step, ..) => s.changed.as_ref().map(|r| format!("What changed: {}", place(r, lang))),
            (Lang::Ja, SpanKind::Busy, ..) => {
                Some("スクロールや動画の再生などで、画面が落ち着かなかった時間です。真ん中の 1 枚を入れています".into())
            }
            (Lang::En, SpanKind::Busy, ..) => {
                Some("The screen kept moving (scrolling, a playing video, etc.). The image is from the middle".into())
            }
            (Lang::Ja, SpanKind::Camera, ..) => Some("画面の共有が無く、カメラの映像だけだった時間です。絵は入れていません".into()),
            (Lang::En, SpanKind::Camera, ..) => Some("No screen was shared, only cameras. No image".into()),
            _ => None,
        };
        if let Some(note) = note {
            out.push(String::new());
            out.push(note);
        }
        if let Some(f) = &s.frame {
            out.push(String::new());
            out.push(format!("![{}]({f})", s.id));
            if s.faces {
                out.push(String::new());
                out.push(match lang {
                    Lang::Ja => "※ この絵には、顔が写っているかもしれません".into(),
                    Lang::En => "Note: this image may show a face".into(),
                });
            }
        }
        if !us.is_empty() {
            out.push(String::new());
            for u in us {
                out.push(format!("- [{}] {}{}: {}", ts(u.start), who(lang, &u.speaker), if u.overlap { "*" } else { "" }, u.text));
            }
        }
    }
    out.join("\n") + "\n"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineUtt {
    start: f64,
    end: f64,
    speaker: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineSpan {
    /// changed・masks は絵に対する割合（crop は録画全体のうち絵にした所）
    #[serde(flatten)]
    span: Span,
    utterances: Vec<TimelineUtt>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Timeline<'a> {
    title: &'a str,
    duration_sec: f64,
    summary: &'a Summary,
    spans: Vec<TimelineSpan>,
}

/// timeline.json（timeline.md と同じ中身のデータ）
pub fn timeline_json(sc: &Screens, utts: &[Utterance], title: &str, lang: Lang) -> String {
    let groups = assign(&sc.spans, utts);
    let spans = sc
        .spans
        .iter()
        .zip(&groups)
        .map(|(span, g)| TimelineSpan {
            span: in_image_span(span),
            utterances: g
                .iter()
                .map(|&k| {
                    let u = &utts[k];
                    TimelineUtt { start: u.start, end: u.end, speaker: who(lang, &u.speaker), text: u.text.clone() }
                })
                .collect(),
        })
        .collect();
    let t = Timeline { title, duration_sec: sc.duration_sec, summary: &sc.summary, spans };
    serde_json::to_string_pretty(&t).unwrap_or_default() + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    // 横 32 × 縦 18 の小さな升（升目は 16 × 9 = 144）
    const SW: usize = 32;
    const SH: usize = 18;

    /// 1 枚の絵を作る道具
    #[derive(Clone)]
    struct Pic(Vec<u8>);

    impl Pic {
        fn flat(v: u8) -> Self {
            Pic(vec![v; SW * SH])
        }
        /// 升目の四角（x0..x1, y0..y1）を v で塗る
        fn fill(mut self, x0: usize, y0: usize, x1: usize, y1: usize, v: u8) -> Self {
            for y in 2 * y0..2 * y1 {
                for x in 2 * x0..2 * x1 {
                    self.0[y * SW + x] = v;
                }
            }
            self
        }
        /// 升目の四角を毎回違う模様に（カメラの代わり）
        fn noise(mut self, x0: usize, y0: usize, x1: usize, y1: usize, seed: u64) -> Self {
            let mut s = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            for y in 2 * y0..2 * y1 {
                for x in 2 * x0..2 * x1 {
                    s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    self.0[y * SW + x] = (s >> 56) as u8;
                }
            }
            self
        }
    }

    fn scan(frames: Vec<(Pic, Vec<Rect>)>) -> Scan {
        Scan {
            video_w: 1920,
            video_h: 1080,
            sig_w: SW,
            sig_h: SH,
            frames: frames.into_iter().enumerate().map(|(i, (p, faces))| ScanFrame { t: i as f64, faces, sig: p.0 }).collect(),
        }
    }

    /// スライド（地の明るさ・中の箱の明るさで見分ける）
    fn slide(k: u8) -> Pic {
        Pic::flat(240).fill(2, 1, 14, 3, 40 + k * 30).fill(2, 4, 14, 8, 60 + k * 25)
    }

    fn kinds(sc: &Screens) -> Vec<SpanKind> {
        sc.spans.iter().map(|s| s.kind).collect()
    }

    fn analyze_default(frames: Vec<(Pic, Vec<Rect>)>) -> Screens {
        analyze(&scan(frames), &ScreensConfig::default())
    }

    fn repeat(p: Pic, n: usize) -> Vec<(Pic, Vec<Rect>)> {
        (0..n).map(|_| (p.clone(), Vec::new())).collect()
    }

    #[test]
    fn scan_file_roundtrip_and_a_cut_last_frame_is_dropped() {
        let s = scan(vec![(slide(1), vec![Rect { x: 0.5, y: 0.25, w: 0.1, h: 0.2 }]), (slide(2), Vec::new())]);
        let b = s.to_bytes();
        assert_eq!(Scan::from_bytes(&b).unwrap(), s);
        let cut = Scan::from_bytes(&b[..b.len() - 3]).unwrap();
        assert_eq!(cut.frames.len(), 1);
        assert!(Scan::from_bytes(b"nope").is_err());
    }

    #[test]
    fn slides_become_scenes_and_the_image_is_the_last_second_of_each() {
        let mut f = repeat(slide(1), 20);
        f.extend(repeat(slide(2), 20));
        f.extend(repeat(slide(3), 20));
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene; 3]);
        let starts: Vec<f64> = sc.spans.iter().map(|s| s.start).collect();
        assert_eq!(starts, vec![0.0, 20.0, 40.0]);
        let shots: Vec<Option<f64>> = sc.spans.iter().map(|s| s.frame_t).collect();
        assert_eq!(shots, vec![Some(19.0), Some(39.0), Some(59.0)]);
        assert_eq!(sc.summary.frames, 3);
        assert_eq!(sc.spans[0].frame.as_deref(), Some("frames/0001.jpg"));
        assert_eq!(sc.spans[2].end, 60.0);
    }

    #[test]
    fn a_small_window_is_a_step_with_its_place() {
        let mut f = repeat(slide(1), 20);
        f.extend(repeat(slide(1).fill(10, 1, 15, 4, 0), 20)); // 右上に窓
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene, SpanKind::Step]);
        let r = sc.spans[1].changed.unwrap();
        assert!(r.x >= 0.6 && r.y < 0.15 && r.w <= 0.4, "{r:?}");
        assert_eq!(place(&r, Lang::Ja).split('（').next(), Some("右上"));
    }

    #[test]
    fn a_moving_mouse_pointer_is_not_a_change() {
        let mut f = Vec::new();
        for i in 0..40 {
            let x = 2 + (i % 10);
            f.push((slide(1).fill(x, 5, x + 1, 6, 0), Vec::new())); // 1 升目の矢印が毎秒動く
        }
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene]);
    }

    #[test]
    fn a_camera_tile_in_the_corner_is_masked_all_along_and_does_not_make_steps() {
        let mut f = Vec::new();
        for i in 0..90 {
            let p = slide(if i < 45 { 1 } else { 2 });
            f.push((p.noise(13, 0, 16, 2, i as u64), Vec::new())); // 右上の小窓（顔は見えない）が毎秒動く
        }
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene, SpanKind::Scene]);
        for s in &sc.spans {
            assert!(s.masks.iter().any(|m| m.x >= 0.75 && m.y == 0.0), "{:?}", s.masks);
        }
    }

    #[test]
    fn a_moving_face_is_camera_but_a_face_in_a_photo_stays_and_is_flagged() {
        let face = Rect { x: 0.84, y: 0.05, w: 0.06, h: 0.12 }; // 右上の小窓の顔
        let photo = Rect { x: 0.4, y: 0.5, w: 0.1, h: 0.2 }; // スライドの中の写真の顔
        let mut f = Vec::new();
        for i in 0..60 {
            // 顔のまわりだけが時々動く（瞬き）。写真は動かない
            let mut p = slide(1).fill(6, 4, 8, 7, 90);
            if i % 4 == 0 {
                p = p.fill(14, 1, 15, 2, 30 + (i as u8 % 7) * 20);
            }
            f.push((p, vec![face, photo]));
        }
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene]);
        let s = &sc.spans[0];
        // 動く顔は塗る（端に接するので区間のあいだずっと）
        assert!(s.masks.iter().any(|m| m.x + m.w >= 0.99 && m.y == 0.0), "{:?}", s.masks);
        // 写真の顔は塗らないが、印を付ける
        assert!(!s.masks.iter().any(|m| m.x <= 0.45 && m.x + m.w >= 0.45 && m.y <= 0.6 && m.y + m.h >= 0.6));
        assert!(s.faces);
        assert_eq!(sc.summary.faces, 1);
    }

    #[test]
    fn a_gallery_of_cameras_is_camera_time_without_images() {
        let mut f = Vec::new();
        for i in 0..40 {
            f.push((Pic::flat(20).noise(0, 0, 16, 9, i as u64), Vec::new()));
        }
        f.extend(repeat(slide(1), 30));
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Camera, SpanKind::Scene]);
        assert!(sc.spans[0].frame.is_none());
        assert_eq!(sc.spans[1].start, 40.0);
        assert_eq!(sc.summary.frames, 1);
        assert_eq!(sc.summary.camera_sec, 40.0);
    }

    #[test]
    fn a_notification_that_goes_away_is_transient_and_the_screen_after_is_the_same() {
        let mut f = repeat(slide(1), 30);
        f.extend(repeat(slide(1).fill(11, 0, 16, 2, 0), 4)); // 右上に 4 秒だけ通知
        f.extend(repeat(slide(1), 30));
        let sc = analyze_default(f);
        assert_eq!(sc.spans.len(), 3);
        assert!(sc.spans[1].transient);
        assert_eq!(sc.spans[1].frame, None);
        assert_eq!(sc.spans[2].same_as, Some(1));
        assert_eq!(sc.spans[2].frame, None);
        assert_eq!(sc.summary.frames, 1);
    }

    #[test]
    fn going_back_to_an_earlier_slide_is_the_same_screen() {
        let mut f = repeat(slide(1), 20);
        f.extend(repeat(slide(2), 20));
        f.extend(repeat(slide(1), 20));
        let sc = analyze_default(f);
        assert_eq!(sc.spans[2].same_as, Some(1));
        assert!(!sc.spans[2].transient);
        assert_eq!(sc.summary.frames, 2);
    }

    #[test]
    fn scrolling_for_a_while_has_no_image_of_its_own_and_joins_the_next_screen() {
        let mut f = repeat(slide(1), 20);
        for i in 0..15 {
            f.push((slide(1).noise(1, 1, 15, 8, 100 + i as u64), Vec::new())); // 中身が毎秒入れ替わる
        }
        f.extend(repeat(slide(3), 20));
        // 間引かなければ、動きの多い時間（真ん中の 1 枚）
        let cfg = ScreensConfig { drop_busy: false, ..ScreensConfig::default() };
        let raw = analyze(&scan(f.clone()), &cfg);
        assert_eq!(kinds(&raw), vec![SpanKind::Scene, SpanKind::Busy, SpanKind::Scene]);
        assert_eq!((raw.spans[1].start, raw.spans[1].frame_t, raw.spans[2].start), (20.0, Some(27.0), 35.0));
        // 間引くと、落ち着いたあとの画面にまとめる（時間は残る）
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene, SpanKind::Scene]);
        assert_eq!((sc.spans[1].start, sc.spans[1].end, sc.spans[1].frame_t), (20.0, 55.0, Some(54.0)));
        assert_eq!(sc.summary.frames, 2);
    }

    #[test]
    fn quick_changes_and_changes_in_the_same_place_are_thinned_but_keep_their_time() {
        // 場面 A → 右上の窓が 3 秒（短い）→ 中央の枠で 12 秒ずつ 3 回変わる（同じ所）→ 場面 B → A に戻る
        let mut f = repeat(slide(1), 20);
        f.extend(repeat(slide(1).fill(10, 0, 15, 2, 0), 3));
        for k in 0..3u8 {
            f.extend(repeat(slide(1).fill(10, 0, 15, 2, 0).fill(4, 4, 12, 8, 20 + k * 40), 12));
        }
        f.extend(repeat(slide(2), 20));
        f.extend(repeat(slide(1), 20));
        let cfg = ScreensConfig { min_step_sec: 0.0, merge_overlap: 0.0, ..ScreensConfig::default() };
        let raw = analyze(&scan(f.clone()), &cfg);
        assert_eq!(raw.summary.frames, 6, "{:?}", kinds(&raw));
        let sc = analyze_default(f);
        // 短い窓は次へ、同じ所の 3 回は最後の 1 枚に: 場面 A・画面の中の変化 1 枚・場面 B・前と同じ
        assert_eq!(kinds(&sc), vec![SpanKind::Scene, SpanKind::Step, SpanKind::Scene, SpanKind::Scene], "{:?}", sc.spans);
        assert_eq!((sc.spans[1].start, sc.spans[1].end, sc.spans[1].frame_t), (20.0, 59.0, Some(58.0)));
        assert_eq!(sc.summary.frames, 3);
        // 「前と同じ」は、まとめたあとの番号を指す
        assert_eq!(sc.spans[3].same_as, Some(1));
        // 区間はすき間なく並ぶ
        for w in sc.spans.windows(2) {
            assert_eq!(w[0].end, w[1].start);
        }
    }

    #[test]
    fn a_short_loading_is_part_of_the_next_screen() {
        let mut f = repeat(slide(1), 20);
        for i in 0..3 {
            f.push((slide(2).noise(3, 4, 13, 8, 7 + i as u64), Vec::new())); // 3 秒の読み込み
        }
        f.extend(repeat(slide(2), 20));
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene, SpanKind::Scene]);
        assert_eq!(sc.spans[1].start, 20.0);
        assert_eq!(sc.spans[1].frame_t, Some(42.0));
    }

    #[test]
    fn when_the_speaker_changes_the_whole_tile_is_learned_and_no_step_is_made() {
        // 右上の小窓（升目 10〜16 × 0〜4）: 右寄りに小さな顔（動く）。話す人が替わると、小窓の背景もまとめて替わる。
        // 顔を広げた四角（升目 13〜16 × 0〜3）は小窓の一部しか覆わない
        let face = Rect { x: 0.88, y: 0.05, w: 0.04, h: 0.08 };
        let mut f = Vec::new();
        for i in 0..80 {
            let bg = if i < 40 { 200 } else { 60 };
            let mut p = slide(1).fill(10, 0, 16, 4, bg);
            if i % 3 == 0 {
                p = p.fill(14, 0, 15, 1, 20 + (i as u8 % 5) * 30);
            }
            f.push((p, vec![face]));
        }
        let sc = analyze_default(f);
        assert_eq!(kinds(&sc), vec![SpanKind::Scene], "{:?}", sc.spans);
        // 広げたあとの小窓全体を塗る
        assert!(sc.spans[0].masks.iter().any(|m| m.x <= 0.625 && m.x + m.w >= 0.99 && m.y == 0.0), "{:?}", sc.spans[0].masks);
    }

    #[test]
    fn a_short_burst_of_motion_at_the_edge_is_not_a_camera() {
        // 実物の録画で起きたこと: 左端で十数秒だけ動いた所（スクロールなど）を小窓とみなし、区間のあいだずっと塗った
        let mut f = repeat(slide(1), 100);
        for i in 0..15 {
            f.push((slide(1).noise(0, 2, 3, 7, 300 + i as u64), Vec::new()));
        }
        f.extend(repeat(slide(2), 100));
        let sc = analyze_default(f);
        for s in &sc.spans {
            assert!(s.masks.is_empty(), "{} {:?} {:?}", s.id, s.kind, s.masks);
        }
    }

    #[test]
    fn masks_keep_their_shape_instead_of_a_big_box() {
        // L 字の形（左の縦の帯と下の横の帯）を、囲む大きな四角にしない
        let g = Grid::new(SW, SH);
        let mut m = vec![false; g.n()];
        g.fill(&mut m, &Cells { x0: 0, y0: 0, x1: 2, y1: 9 });
        g.fill(&mut m, &Cells { x0: 2, y0: 7, x1: 16, y1: 9 });
        let rs = g.rects(&m);
        let area: f64 = rs.iter().map(|r| r.w * r.h).sum();
        let want = (2.0 * 9.0 + 14.0 * 2.0) / g.n() as f64;
        assert!((area - want).abs() < 1e-3, "{rs:?}");
        assert!(rs.iter().all(|r| r.w * r.h <= 14.0 * 2.0 / g.n() as f64 + 1e-3 || r.x == 0.0), "{rs:?}");
    }

    #[test]
    fn utterances_go_to_the_span_holding_their_middle() {
        let mut f = repeat(slide(1), 20);
        f.extend(repeat(slide(2), 20));
        let sc = analyze_default(f);
        let u = |s: f64, e: f64| Utterance { start: s, end: e, speaker: "話者A".into(), text: "x".into(), overlap: false };
        let utts = vec![u(1.0, 5.0), u(18.0, 23.0), u(19.0, 20.5), u(39.0, 45.0)];
        assert_eq!(assign(&sc.spans, &utts), vec![vec![0, 2], vec![1, 3]]);
    }

    #[test]
    fn timeline_lists_images_places_and_remarks() {
        let mut f = repeat(slide(1), 20);
        f.extend(repeat(slide(1).fill(10, 1, 15, 4, 0), 20));
        let sc = analyze_default(f);
        let utts = vec![
            Utterance { start: 2.0, end: 4.0, speaker: "田中".into(), text: "保存を押します".into(), overlap: false },
            Utterance { start: 25.0, end: 27.0, speaker: UNKNOWN.into(), text: "はい".into(), overlap: false },
        ];
        let md = timeline_md(&sc, &utts, "定例会議", Lang::Ja);
        assert!(md.starts_with("# 画面と発言の流れ：定例会議\n"));
        assert!(md.contains("## 1. 場面の切り替わり［00:00〜00:20］"));
        assert!(md.contains("### 2. 画面の中の変化［00:20〜00:40］"));
        assert!(md.contains("変わった所：右上"));
        assert!(md.contains("![1](frames/0001.jpg)"));
        assert!(md.contains("- [00:02] 田中: 保存を押します"));
        assert!(md.contains("- [00:25] 確認用: はい"));
        assert!(md.contains("表示していた時間 20秒・発言 1（田中 1）"));
        let en = timeline_md(&sc, &utts, "Weekly", Lang::En);
        assert!(en.contains("## 1. Scene change [00:00–00:20]"));
        assert!(en.contains("- [00:25] Unassigned: はい"));
        let js: serde_json::Value = serde_json::from_str(&timeline_json(&sc, &utts, "定例会議", Lang::Ja)).unwrap();
        assert_eq!(js["spans"][0]["frame"], "frames/0001.jpg");
        assert_eq!(js["spans"][1]["utterances"][0]["speaker"], "確認用");
    }

    #[test]
    fn short_flips_between_camera_and_share_are_smoothed() {
        let raw = [true, true, false, true, true, true, true, true, false, false, false, false, false, false, true, false];
        let s = smooth(&raw, 5);
        assert_eq!(s, vec![true, true, true, true, true, true, true, true, false, false, false, false, false, false, false, false]);
        assert_eq!(fmt_len(148.0, Lang::Ja), "2分28秒");
        assert_eq!(fmt_len(3725.0, Lang::Ja), "1時間2分");
    }

    // ---- 切り出し（会議アプリの参加者の枠。2026-10-13） ----

    // 会議の録画らしい 1 枚の大きさ（小さな升 横 64 × 縦 36。升目は 32 × 18）
    const MW: usize = 64;
    const MH: usize = 36;

    /// 白い地のスライド（k 枚目: 地 240・上に見出しの箱・下に文字の行。w×h の中の x, y）
    fn page(k: usize, x: usize, y: usize, w: usize, h: usize) -> u8 {
        if (2..6).contains(&y) && (3..w - 3).contains(&x) {
            40 + 25 * (k % 8) as u8
        } else if y >= 8 && y + 2 < h && y % 3 == 0 && (3..w - 6).contains(&x) && (x / 2 + k) % 3 != 0 {
            60
        } else {
            240
        }
    }

    /// 1 枚ごとに地の色も替わるスライド（k 枚目。24 枚で一回り）
    fn deck(k: usize, x: usize, y: usize, w: usize, h: usize) -> u8 {
        match page(k, x, y, w, h) {
            240 => 110 + 22 * (k % 6) as u8,
            v => v,
        }
    }

    /// 並び: 共有した画面は列 0..cw・行 top..bottom（上下は暗い灰 17 の帯）、右は黒（0）の地に参加者の四角（17）
    /// （Zoom の「共有画面の横に映像を置く」のまね）
    #[derive(Clone, Copy)]
    struct Layout {
        cw: usize,
        top: usize,
        bottom: usize,
    }

    const ZOOM: Layout = Layout { cw: 48, top: 5, bottom: 31 };

    /// 会議の録画の 1 枚（k 枚目のスライド。参加者の四角の中に、丸 avatar と名前の帯 name）
    fn meeting(l: Layout, k: usize, avatar: u8, name: u8) -> Vec<u8> {
        let mut v = vec![0u8; MW * MH];
        for y in 0..MH {
            for x in 0..MW {
                v[y * MW + x] = if x < l.cw {
                    if y < l.top || y >= l.bottom { 17 } else { deck(k, x, y - l.top, l.cw, l.bottom - l.top) }
                } else if (12..26).contains(&y) {
                    if (14..20).contains(&y) && (l.cw + 5..l.cw + 11).contains(&x) {
                        avatar
                    } else if (22..24).contains(&y) && (l.cw + 2..(l.cw + 14).min(MW - 2)).contains(&x) {
                        name
                    } else {
                        17
                    }
                } else {
                    0
                };
            }
        }
        v
    }

    fn scan_of(sigs: Vec<Vec<u8>>) -> Scan {
        let frames = sigs.into_iter().enumerate().map(|(i, sig)| ScanFrame { t: i as f64, faces: Vec::new(), sig }).collect();
        Scan { video_w: 1280, video_h: 720, sig_w: MW, sig_h: MH, frames }
    }

    /// 並び l の、共有した画面の四角（割合）
    fn shared(l: Layout) -> Rect {
        sig_rect(&Cells { x0: 0, y0: l.top, x1: l.cw, y1: l.bottom }, MW, MH)
    }

    #[test]
    fn the_participant_panel_and_the_borders_are_cut_off_and_places_are_in_the_image() {
        // 10 分・20 秒ごとにスライド。8 枚目の後半は、共有した画面の右寄りに窓が出る（画面の中の変化）
        let f: Vec<Vec<u8>> = (0..600)
            .map(|t| {
                let k = t / 20;
                let mut v = meeting(ZOOM, k, 150, 38);
                if k == 7 && t % 20 >= 10 {
                    for y in 12..20 {
                        for x in 36..46 {
                            v[y * MW + x] = 0;
                        }
                    }
                }
                v
            })
            .collect();
        let sc = analyze(&scan_of(f), &ScreensConfig::default());
        let shots: Vec<&Span> = sc.spans.iter().filter(|s| s.frame.is_some()).collect();
        assert!(shots.len() >= 20, "{}", shots.len());
        for s in &shots {
            assert_eq!(s.crop, Some(shared(ZOOM)), "{} {:?}", s.id, s.crop);
            assert!(s.masks.is_empty(), "{:?}", s.masks);
        }
        assert_eq!(sc.summary.cropped, sc.summary.frames);
        // 窓は、録画全体では真ん中寄り（左から 56〜72%）だが、絵（共有した画面）では右（75〜96%）
        let step = sc.spans.iter().find(|s| s.kind == SpanKind::Step).expect("窓の変化");
        let full = step.changed.unwrap();
        assert!(full.x > 0.5 && full.x + full.w < 0.75, "{full:?}");
        let md = timeline_md(&sc, &[], "t", Lang::Ja);
        assert!(md.contains("変わった所：右（"), "{md}");
        assert!(md.contains(&format!("絵 {} 枚は、共有していた画面の部分だけを切り出しています", sc.summary.frames)), "{md}");
        let js: serde_json::Value = serde_json::from_str(&timeline_json(&sc, &[], "t", Lang::Ja)).unwrap();
        let s = js["spans"].as_array().unwrap().iter().find(|s| s["kind"] == "step").unwrap();
        assert!(s["changed"]["x"].as_f64().unwrap() >= 0.7, "{s}");
        assert_eq!(s["crop"]["w"], 0.75);
    }

    #[test]
    fn speaker_changes_in_the_panel_make_no_images_of_their_own() {
        // 話す人が 11 秒ごとに替わり、参加者の四角の丸と名前が替わる（3 人）
        let talk = |t: usize| {
            let who = (t / 11) % 3;
            meeting(ZOOM, t / 20, [150, 90, 200][who], [38, 30, 34][who])
        };
        let f: Vec<Vec<u8>> = (0..600).map(talk).collect();
        let sc = analyze(&scan_of(f.clone()), &ScreensConfig::default());
        let still = analyze(&scan_of((0..600).map(|t| meeting(ZOOM, t / 20, 150, 38)).collect()), &ScreensConfig::default());
        assert_eq!(sc.summary.frames, still.summary.frames, "{:?}", kinds(&sc));
        assert_eq!(sc.summary.cropped, sc.summary.frames);
        // 切り出さなければ、四角の替わり目が画面の中の変化になって絵が増える
        let off = analyze(&scan_of(f), &ScreensConfig { crop: false, ..ScreensConfig::default() });
        assert!(off.summary.frames > still.summary.frames, "{} {}", off.summary.frames, still.summary.frames);
        assert_eq!(off.summary.cropped, 0);
    }

    #[test]
    fn after_the_layout_changes_the_new_panel_is_cut_and_the_shared_screen_is_never_cut() {
        // 15 分で並びが変わる（Meet のように、参加者の列が広がって共有した画面が小さくなる）
        let wide = Layout { cw: 40, top: 7, bottom: 29 };
        let at = |t: usize| if t < 900 { ZOOM } else { wide };
        let f: Vec<Vec<u8>> = (0..1800).map(|t| meeting(at(t), t / 20, 150, 38)).collect();
        let sc = analyze(&scan_of(f), &ScreensConfig::default());
        let mut n = 0;
        for s in sc.spans.iter().filter(|s| s.frame.is_some()) {
            let t = s.frame_t.unwrap();
            let want = shared(at(t as usize));
            if let Some(c) = s.crop {
                // 共有した画面を欠かない
                let e = 1e-9;
                assert!(c.x <= want.x + e && c.y <= want.y + e && c.x + c.w >= want.x + want.w - e && c.y + c.h >= want.y + want.h - e, "{t} {c:?} {want:?}");
            }
            // 変わる 6 分前までは前の並びで、変わって 6 分たてば新しい並びで切る
            if !(540.0..=1260.0).contains(&t) {
                assert_eq!(s.crop, Some(want), "{t}");
                n += 1;
            }
        }
        assert!(n >= 20, "{n}");
    }

    #[test]
    fn a_full_screen_slide_with_white_margins_is_not_cut() {
        let f: Vec<Vec<u8>> = (0..600).map(|t| (0..MW * MH).map(|p| page(t / 20, p % MW, p / MW, MW, MH)).collect()).collect();
        let sc = analyze(&scan_of(f), &ScreensConfig::default());
        assert!(sc.summary.frames > 0);
        assert!(sc.spans.iter().all(|s| s.crop.is_none()), "{:?}", sc.spans.iter().map(|s| s.crop).collect::<Vec<_>>());
    }

    #[test]
    fn a_menu_with_words_at_the_edge_is_not_cut() {
        // 画面いっぱいの共有で、左の 12 列は文字の並ぶメニュー（動かない）。右だけがスライドで替わる
        let f: Vec<Vec<u8>> = (0..600)
            .map(|t| {
                (0..MW * MH)
                    .map(|p| {
                        let (x, y) = (p % MW, p / MW);
                        if x >= 12 {
                            page(t / 20, x - 12, y, MW - 12, MH)
                        } else if y % 3 == 1 && (2..10).contains(&x) && (x + y) % 4 != 0 {
                            200
                        } else {
                            50
                        }
                    })
                    .collect()
            })
            .collect();
        let sc = analyze(&scan_of(f), &ScreensConfig::default());
        assert!(sc.summary.frames > 0);
        for s in &sc.spans {
            assert!(s.crop.is_none_or(|c| c.x == 0.0), "{:?}", s.crop);
        }
    }

    #[test]
    fn rects_are_moved_into_the_image() {
        let crop = Rect { x: 0.0, y: 0.125, w: 0.75, h: 0.75 };
        assert_eq!(in_image(&Rect { x: 0.375, y: 0.5, w: 0.1875, h: 0.1875 }, &crop), Some(Rect { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }));
        // はみ出しは切り、絵の外は無し
        assert_eq!(in_image(&Rect { x: 0.7, y: 0.0, w: 0.2, h: 0.25 }, &crop), Some(Rect { x: 0.9333, y: 0.0, w: 0.0667, h: 0.1667 }));
        assert_eq!(in_image(&Rect { x: 0.8, y: 0.2, w: 0.1, h: 0.1 }, &crop), None);
        let span = Span {
            id: 1,
            kind: SpanKind::Step,
            start: 0.0,
            end: 1.0,
            frame_t: Some(0.0),
            frame: None,
            same_as: None,
            transient: false,
            changed: Some(Rect { x: 0.375, y: 0.5, w: 0.1875, h: 0.1875 }),
            crop: Some(crop),
            masks: vec![Rect { x: 0.8, y: 0.0, w: 0.2, h: 0.2 }],
            faces: false,
        };
        let shown = in_image_span(&span);
        assert_eq!(shown.changed, Some(Rect { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }));
        assert!(shown.masks.is_empty());
        assert_eq!(shown.crop, Some(crop));
    }
}
