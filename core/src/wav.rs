//! WAV の切り出し（移植元 speakers.py の `cut_wav`。Python 標準の wave と同じバイト列を書く）。
//!
//! 読み: RIFF の中の塊（chunk）を順に見て `fmt ` と `data` を探す。ほかの塊は読み飛ばす（奇数の長さは1バイト詰める）。
//! 書き: 44 バイトの見出し（PCM）＋音声のバイト列。Python の wave も最後に長さを書き直すので同じ形になる。

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::pycompat;

/// 読み取った WAV の形（Python の wave の getparams と同じ項目）
#[derive(Clone, Debug, PartialEq)]
pub struct WavInfo {
    pub channels: u16,
    pub sampwidth: u16, // 1サンプルのバイト数
    pub rate: u32,
    pub nframes: u64,
    data_offset: u64,
    data_len: u64,
}

fn err(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.to_string())
}

fn u16le(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}

fn u32le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

pub fn read_info(f: &mut File) -> io::Result<WavInfo> {
    let mut head = [0u8; 12];
    f.read_exact(&mut head)?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        return Err(err("WAV ではない"));
    }
    let mut fmt: Option<(u16, u16, u32)> = None;
    loop {
        let mut ch = [0u8; 8];
        if f.read_exact(&mut ch).is_err() {
            return Err(err("data の塊が無い"));
        }
        let size = u32le(&ch[4..8]) as u64;
        let start = f.stream_position()?;
        match &ch[0..4] {
            b"fmt " => {
                let mut b = vec![0u8; size.min(64) as usize];
                f.read_exact(&mut b)?;
                let tag = u16le(&b[0..2]);
                if tag != 1 && tag != 0xFFFE {
                    return Err(err("PCM 以外の WAV には対応していない"));
                }
                let bits = u16le(&b[14..16]);
                fmt = Some((u16le(&b[2..4]), bits.div_ceil(8), u32le(&b[4..8])));
            }
            b"data" => {
                let (channels, sampwidth, rate) = fmt.ok_or_else(|| err("fmt の塊より前に data がある"))?;
                let frame = channels as u64 * sampwidth as u64;
                return Ok(WavInfo { channels, sampwidth, rate, nframes: size / frame, data_offset: start, data_len: size });
            }
            _ => {}
        }
        f.seek(SeekFrom::Start(start + size + (size & 1)))?; // 奇数の長さの塊は1バイト詰めてある
    }
}

/// Python の wave が書くのと同じ 44 バイトの見出しと音声（PCM）。
pub fn write(dst: &Path, channels: u16, sampwidth: u16, rate: u32, frames: &[u8]) -> io::Result<()> {
    let n = frames.len() as u32;
    let mut h = Vec::with_capacity(44 + frames.len());
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + n).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes()); // PCM
    h.extend_from_slice(&channels.to_le_bytes());
    h.extend_from_slice(&rate.to_le_bytes());
    h.extend_from_slice(&(channels as u32 * rate * sampwidth as u32).to_le_bytes());
    h.extend_from_slice(&(channels * sampwidth).to_le_bytes());
    h.extend_from_slice(&(sampwidth * 8).to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&n.to_le_bytes());
    h.extend_from_slice(frames);
    File::create(dst)?.write_all(&h)
}

/// WAV から区間を切り出す（前後に pad 秒の余白、長さは start から最長 max_sec 秒）。既定は pad 0.2・max_sec 12
pub fn cut(src: &Path, start: f64, end: f64, dst: &Path, pad: f64, max_sec: f64) -> io::Result<()> {
    let mut f = File::open(src)?;
    let info = read_info(&mut f)?;
    let sr = info.rate as f64;
    let a = pycompat::int((start - pad) * sr).max(0);
    let b = (info.nframes as i64).min(pycompat::int(pycompat::min(end + pad, start + max_sec) * sr));
    if a as u64 > info.nframes {
        return Err(err("切り出す位置が音声の長さを超えている")); // Python の wave の setpos と同じく失敗させる
    }
    let frame = info.channels as u64 * info.sampwidth as u64;
    let want = (b - a).max(0) as u64 * frame;
    let offset = a as u64 * frame;
    let len = want.min(info.data_len.saturating_sub(offset));
    let mut frames = vec![0u8; len as usize];
    f.seek(SeekFrom::Start(info.data_offset + offset))?;
    f.read_exact(&mut frames)?;
    write(dst, info.channels, info.sampwidth, info.rate, &frames)
}
