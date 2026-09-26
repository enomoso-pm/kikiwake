import { describe, expect, it } from "vitest";
import {
  basename,
  fileFormatLabel,
  formatClock,
  formatCount,
  formatEstimate,
  formatFileSize,
  formatModelSize,
  formatMonthDay,
  formatProgressBytes,
  formatRemaining,
  truncate,
} from "./format";

describe("時間の書き方（§2.8）", () => {
  it("経過時間・録音の長さ", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(163.85)).toBe("2:43");
    expect(formatClock(750)).toBe("12:30");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(4068.9)).toBe("1:07:48");
  });

  it("残り時間は分に切り上げ、1分未満でも約1分", () => {
    expect(formatRemaining(20)).toBe("残り 約1分");
    expect(formatRemaining(1181)).toBe("残り 約20分");
    expect(formatRemaining(3600)).toBe("残り 約1時間");
    expect(formatRemaining(6480)).toBe("残り 約1時間48分");
  });

  it("所要時間の目安", () => {
    expect(formatEstimate(33, 66)).toBe("約 1 分");
    expect(formatEstimate(814, 1628)).toBe("約 14〜27 分");
    expect(formatEstimate(1680, 2160)).toBe("約 28〜36 分");
    expect(formatEstimate(2880, 5760)).toBe("約 48分〜1時間36分");
    expect(formatEstimate(6000, 7800)).toBe("約 1時間40分〜2時間10分");
  });
});

describe("大きさ（§2.8）", () => {
  it("AI モデルの大きさ", () => {
    expect(formatModelSize(107_012_128)).toBe("107 MB");
    expect(formatModelSize(3_095_033_483)).toBe("3.1 GB");
    expect(formatModelSize(3_095_033_483 + 107_012_128)).toBe("3.2 GB");
  });

  it("取れた量と全体", () => {
    expect(formatProgressBytes(1_420_000_000, 3_100_000_000)).toBe("1.42 / 3.10 GB");
    expect(formatProgressBytes(52_000_000, 107_012_128)).toBe("52 / 107 MB");
  });

  it("録音のファイル", () => {
    expect(formatFileSize(5_243_376)).toBe("5.2 MB");
    expect(formatFileSize(62_400_000)).toBe("62.4 MB");
    expect(formatFileSize(228_000_000)).toBe("228 MB");
    expect(formatFileSize(1_400_000_000)).toBe("1.4 GB");
  });
});

describe("そのほか", () => {
  it("日付・形式・パス・数", () => {
    expect(formatMonthDay("2026-09-24")).toBe("9月24日");
    expect(formatMonthDay("")).toBeNull();
    expect(fileFormatLabel("定例会議.M4A")).toBe("m4a（ボイスメモ）");
    expect(fileFormatLabel("要件レビュー.wav")).toBe("wav");
    expect(basename("/Users/example/Movies/a.m4a")).toBe("a.m4a");
    expect(basename("C:\\Users\\example\\Movies\\b.mp4")).toBe("b.mp4");
    expect(formatCount(8120)).toBe("8,120");
  });

  it("冒頭70字。エンジンが切ったものはそのまま", () => {
    const long = "あ".repeat(75);
    expect(truncate(long)).toBe("あ".repeat(70) + "…");
    expect(truncate(truncate(long))).toBe(truncate(long));
    expect(truncate("短い")).toBe("短い");
  });
});
