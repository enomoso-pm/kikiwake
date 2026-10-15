//! zip を書く（マニュアルの素材）。外から入れる部品を足さないよう、圧縮しない形（stored）だけを書く。
//! 中身の大半は PNG（もともと圧縮されている）なので、圧縮しなくても大きさはほとんど変わらない。
//! ファイル名は UTF-8（汎用フラグの 11 番）。4GB を超える zip（ZIP64）は書かない。
use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::Path;

/// CRC-32（IEEE。zip と同じ）
fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *v = c;
        }
        t
    });
    !data.iter().fold(!0u32, |c, &b| table[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8))
}

/// MS-DOS の日時（zip の中のファイルの更新日時）。今の時刻（この Mac の時間帯）
fn dos_time() -> (u16, u16) {
    use chrono::{Datelike, Timelike};
    let now = chrono::Local::now();
    let time = ((now.hour() << 11) | (now.minute() << 5) | (now.second() / 2)) as u16;
    let date = (((now.year().clamp(1980, 2107) - 1980) as u32) << 9 | now.month() << 5 | now.day()) as u16;
    (time, date)
}

/// entries（zip の中の名前・中身）を path に書く。途中で失敗したら書きかけを消す
pub fn write(path: &Path, entries: &[(String, Vec<u8>)]) -> io::Result<()> {
    let r = write_inner(path, entries);
    if r.is_err() {
        let _ = std::fs::remove_file(path);
    }
    r
}

fn write_inner(path: &Path, entries: &[(String, Vec<u8>)]) -> io::Result<()> {
    let too_big = || io::Error::new(io::ErrorKind::InvalidInput, "4GB を超える zip は書けない");
    let mut w = BufWriter::new(File::create(path)?);
    let (time, date) = dos_time();
    let mut central: Vec<u8> = Vec::new();
    let mut offset: u64 = 0;
    for (name, data) in entries {
        let crc = crc32(data);
        let size = u32::try_from(data.len()).map_err(|_| too_big())?;
        let name_b = name.as_bytes();
        let here = u32::try_from(offset).map_err(|_| too_big())?;
        // ローカルファイルヘッダ
        let mut h: Vec<u8> = Vec::with_capacity(30 + name_b.len());
        h.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        h.extend_from_slice(&20u16.to_le_bytes()); // 展開に要る版 2.0
        h.extend_from_slice(&0x0800u16.to_le_bytes()); // 名前は UTF-8
        h.extend_from_slice(&0u16.to_le_bytes()); // 圧縮しない
        h.extend_from_slice(&time.to_le_bytes());
        h.extend_from_slice(&date.to_le_bytes());
        h.extend_from_slice(&crc.to_le_bytes());
        h.extend_from_slice(&size.to_le_bytes());
        h.extend_from_slice(&size.to_le_bytes());
        h.extend_from_slice(&(name_b.len() as u16).to_le_bytes());
        h.extend_from_slice(&0u16.to_le_bytes());
        h.extend_from_slice(name_b);
        w.write_all(&h)?;
        w.write_all(data)?;
        offset += h.len() as u64 + data.len() as u64;
        // 中央ディレクトリの1件
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&((3u16 << 8) | 20).to_le_bytes()); // 作った環境 Unix・版 2.0
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&time.to_le_bytes());
        central.extend_from_slice(&date.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&(name_b.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0u8; 8]); // 拡張・コメントの長さ、ディスク番号、内部属性
        central.extend_from_slice(&(0o100644u32 << 16).to_le_bytes()); // 外部属性: 普通のファイル rw-r--r--
        central.extend_from_slice(&here.to_le_bytes());
        central.extend_from_slice(name_b);
    }
    let cd_offset = u32::try_from(offset).map_err(|_| too_big())?;
    let count = u16::try_from(entries.len()).map_err(|_| too_big())?;
    w.write_all(&central)?;
    // 中央ディレクトリの終わり
    let mut end: Vec<u8> = Vec::with_capacity(22);
    end.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    end.extend_from_slice(&[0u8; 4]);
    end.extend_from_slice(&count.to_le_bytes());
    end.extend_from_slice(&count.to_le_bytes());
    end.extend_from_slice(&(central.len() as u32).to_le_bytes());
    end.extend_from_slice(&cd_offset.to_le_bytes());
    end.extend_from_slice(&0u16.to_le_bytes());
    w.write_all(&end)?;
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_the_standard_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    /// macOS の unzip で中身が読めて、名前（日本語も）と中身がそのまま戻る
    #[test]
    fn unzip_reads_what_we_wrote() {
        let dir = std::env::temp_dir().join(format!("kikiwake-zip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let zip = dir.join("素材.zip");
        let entries = vec![
            ("README.md".to_string(), "# 読み方\n".as_bytes().to_vec()),
            ("frames/0001.png".to_string(), vec![0u8, 1, 2, 3, 255]),
            ("日本語.txt".to_string(), "中身".as_bytes().to_vec()),
        ];
        write(&zip, &entries).unwrap();
        let test = std::process::Command::new("/usr/bin/unzip").arg("-t").arg(&zip).output().unwrap();
        assert!(test.status.success(), "{}", String::from_utf8_lossy(&test.stdout));
        let out = dir.join("out");
        let st = std::process::Command::new("/usr/bin/unzip").arg("-q").arg(&zip).arg("-d").arg(&out).status().unwrap();
        assert!(st.success());
        for (name, data) in &entries {
            assert_eq!(&std::fs::read(out.join(name)).unwrap(), data, "{name}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
