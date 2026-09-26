//! 動作条件の確認（初回セットアップ）。OS・チップ・メモリ・空き容量・GPU。
//! 画面は「値」（osVersion・cpu・memoryGB・freeDiskGB・gpu.name）と「表示文」（checks[].message）を別の列に出すので、
//! 表示文には値を繰り返さない（UI 画面仕様書 ver1.1 §4.3 の書き方）。
use std::ffi::CString;

use crate::job::{free_bytes, Engine};
use crate::models::get_models;
use crate::types::{EnvironmentCheck, EnvironmentItem, Gpu, Level};

fn sysctl_raw(name: &str) -> Option<Vec<u8>> {
    let c = CString::new(name).ok()?;
    let mut len: libc::size_t = 0;
    // SAFETY: 長さを問い合わせてから、その大きさの領域に読む
    unsafe {
        if libc::sysctlbyname(c.as_ptr(), std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0) != 0 || len == 0 {
            return None;
        }
        let mut buf = vec![0u8; len];
        if libc::sysctlbyname(c.as_ptr(), buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0) != 0 {
            return None;
        }
        buf.truncate(len);
        Some(buf)
    }
}

fn sysctl_string(name: &str) -> Option<String> {
    let b = sysctl_raw(name)?;
    Some(String::from_utf8_lossy(b.split(|&c| c == 0).next().unwrap_or(&[])).trim().to_string())
}

fn sysctl_u64(name: &str) -> Option<u64> {
    let b = sysctl_raw(name)?;
    match b.len() {
        8 => Some(u64::from_ne_bytes(b.try_into().ok()?)),
        4 => Some(u32::from_ne_bytes(b.try_into().ok()?) as u64),
        _ => None,
    }
}

/// GPU のコア数（ioreg の gpu-core-count。取れなければ None）
fn gpu_cores() -> Option<u64> {
    let out = std::process::Command::new("/usr/sbin/ioreg").args(["-rc", "AGXAccelerator", "-d", "1"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().find(|l| l.contains("\"gpu-core-count\"")).and_then(|l| l.split('=').nth(1)).and_then(|v| v.trim().parse().ok())
}

fn item(id: &str, level: Level, message: &str) -> EnvironmentItem {
    EnvironmentItem { id: id.into(), level, message: message.into() }
}

/// 作業用に要る空き（4 時間級の録音の WAV 約 1GB と、書き起こし・サンプル音声など）
const WORK_BYTES: u64 = 2_000_000_000;
/// これより空きが少なければ「注意」（長い録音を続けて処理すると足りなくなる）
const WARN_BYTES: u64 = 10_000_000_000;

pub fn check_environment(engine: &Engine) -> EnvironmentCheck {
    let os_version = sysctl_string("kern.osproductversion").unwrap_or_default();
    let major: u32 = os_version.split('.').next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let cpu = sysctl_string("machdep.cpu.brand_string").unwrap_or_else(|| "不明".into());
    let apple_silicon = sysctl_u64("hw.optional.arm64") == Some(1);
    let memory_gb = (sysctl_u64("hw.memsize").unwrap_or(0) as f64 / (1u64 << 30) as f64).round() as u64;
    let free = free_bytes(&engine.paths.models).unwrap_or(0);
    // まだ取っていないモデルの残り＋作業用
    let missing: u64 = get_models(engine).iter().map(|m| m.size_bytes - m.downloaded_bytes).sum();
    let need = missing + WORK_BYTES;

    let mut checks = vec![
        if major >= 14 { item("os", Level::Ok, "対応しています") } else { item("os", Level::Error, "macOS 14 以降が必要です。") },
        if apple_silicon {
            item("cpu", Level::Ok, "対応しています")
        } else {
            item("cpu", Level::Error, "Apple シリコン（M1 以降）の Mac が必要です。")
        },
        match memory_gb {
            m if m >= 16 => item("memory", Level::Ok, "足りています"),
            m if m >= 8 => item("memory", Level::Warn, "長い録音では、他のアプリを閉じてから実行してください。"),
            _ => item("memory", Level::Error, "8 GB 以上のメモリが必要です。"),
        },
        if free < need {
            item("disk", Level::Error, "空きが足りません。AI モデルの保存に約 3.2 GB と、作業用の空きが要ります。")
        } else if free < need + WARN_BYTES {
            item("disk", Level::Warn, "今は足ります。長い録音を続けて処理すると足りなくなることがあります。")
        } else {
            item("disk", Level::Ok, "モデルと作業用に足りています")
        },
    ];
    let gpu = if apple_silicon {
        checks.push(item("gpu", Level::Ok, "使えます"));
        let name = match gpu_cores() {
            Some(n) => format!("{cpu} GPU（{n}コア）"),
            None => format!("{cpu} GPU"),
        };
        Gpu { kind: "metal".into(), name }
    } else {
        checks.push(item("gpu", Level::Warn, "使えません。時間がかかります。"));
        Gpu { kind: "none".into(), name: String::new() }
    };
    let can_run = checks.iter().all(|c| c.level != Level::Error);
    EnvironmentCheck {
        os: "macos".into(),
        os_version,
        cpu,
        memory_gb,
        free_disk_gb: (free as f64 / 1e8).floor() / 10.0,
        gpu,
        checks,
        can_run,
    }
}
