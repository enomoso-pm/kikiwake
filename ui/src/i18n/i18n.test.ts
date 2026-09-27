import { afterEach, describe, expect, it } from "vitest";
import errorsJson from "@contract/fixtures/errors.json";
import envMacJson from "@contract/fixtures/environment_mac.json";
import envProblemJson from "@contract/fixtures/environment_problem_example.json";
import envWindowsJson from "@contract/fixtures/environment_windows_example.json";
import type { AppError, EnvironmentCheck } from "@contract/types";
import { formatEstimate, formatMonthDay, formatRemaining } from "../lib/format";
import { formatHints } from "../lib/names";
import { en } from "./en";
import { getT, initialLocale, setLocale } from "./index";
import { ja } from "./ja";

const JAPANESE = /[぀-ヿ一-鿿「」（）・、。]/;

/** 辞書の形（鍵の並び）。関数は "fn" */
function shape(v: unknown): unknown {
  if (typeof v === "function") return "fn";
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
  return typeof v;
}

/** 辞書の中の文字（関数は除く） */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

afterEach(() => setLocale("ja"));

describe("辞書", () => {
  it("英語は日本語と同じ形", () => {
    expect(shape(en)).toEqual(shape(ja));
  });

  it("英語の辞書の文字に日本語が混ざっていない", () => {
    expect(strings(en).filter((s) => JAPANESE.test(s))).toEqual([]);
  });

  it("テスト（ブラウザの外）では日本語", () => {
    expect(initialLocale()).toBe("ja");
    expect(getT()).toBe(ja);
  });
});

describe("エンジンが日本語で返す文を英語に", () => {
  const errors = errorsJson as Record<string, AppError>;

  it("エラーはどの code も英語になる", () => {
    for (const [code, e] of Object.entries(errors)) {
      const text = en.engine.error({ ...e, code: code as AppError["code"] });
      expect(JAPANESE.test(text), `${code}: ${text}`).toBe(false);
    }
  });

  it("空き容量のエラーは要る量を読む", () => {
    expect(en.engine.error({ code: "disk_full", message: "空き容量が足りません。あと約2GB の空きが要ります。" })).toBe(
      "Not enough free space. About 2 GB more is needed.",
    );
  });

  it("中止は話者判定を残したかで分ける", () => {
    expect(en.engine.error({ code: "cancelled", message: "中止しました。" })).toBe("Canceled.");
    expect(en.engine.error({ code: "cancelled", message: "中止しました。話者の判定結果は残してあるので、やり直すと続きから始めます。" })).toMatch(/kept/);
  });

  it("日本語では、エンジンの文を画面の言葉にそろえて出す（2026-09-27。知らない code の文はそのまま）", () => {
    expect(ja.engine.error(errors.engine_failed)).toBe(
      "文字起こしの途中で問題が起きました。もう一度実行してください。続く場合は詳細をコピーして連絡してください。",
    );
    expect(ja.engine.error({ code: "cancelled", message: "中止しました。話者の判定結果は残してあるので、やり直すと続きから始めます。" })).toBe(
      "中止しました。声の聞き分けの結果は残してあるので、再開すると続きからはじめます。",
    );
    // 空き容量は数が入るのでエンジンの文のまま
    expect(ja.engine.error(errors.disk_full)).toBe(errors.disk_full.message);
    expect(ja.engine.error({ code: "engine_failed_x" as never, message: "知らない文" })).toBe("知らない文");
    // 用語の決まり（ja.ts の頭）でやめた言葉が、エラーの文に残っていない
    for (const e of Object.values(errors)) expect(ja.engine.error(e), e.code).not.toMatch(/書き起こし|話者の判定|セットアップ|元の録音/);
  });

  it("動作条件の文はどれも英語になる（見本の3つとも）", () => {
    for (const env of [envMacJson, envProblemJson, envWindowsJson] as EnvironmentCheck[]) {
      for (const item of env.checks) {
        const text = en.engine.envMessage(item);
        expect(JAPANESE.test(text), `${item.id}: ${text}`).toBe(false);
      }
      expect(JAPANESE.test(en.engine.gpuName(env.gpu.name)), env.gpu.name).toBe(false);
    }
    expect(en.engine.gpuName("Apple M4 GPU（10コア）")).toBe("Apple M4 GPU (10-core)");
  });

  it("話者のラベル", () => {
    expect(en.engine.speakerLabel("話者A")).toBe("Speaker A");
    expect(en.engine.speakerLabel("話者AB")).toBe("Speaker AB");
    expect(en.engine.speakerLabel("不明")).toBe("Unassigned");
    // 画面では、保存したファイルの見出しと同じ「確認用」
    expect(ja.engine.speakerLabel("不明")).toBe("確認用");
    expect(en.engine.speakerLabel("松本")).toBe("松本");
    expect(ja.engine.speakerLabel("話者A")).toBe("話者A");
  });

  it("繰り返しの知らせは時刻から作り直す", () => {
    expect(en.engine.repeat({ startSec: 1003, endSec: 3963, speechSec: 2584, message: "" })).toBe(
      "The transcript from 0:16:43 to 1:06:03 repeats the same sentence and can't be read.",
    );
  });
});

describe("英語の書き方", () => {
  it("時間と日付", () => {
    setLocale("en");
    expect(formatRemaining(20)).toBe("About 1 min left");
    expect(formatRemaining(6480)).toBe("About 1 hr 48 min left");
    expect(formatEstimate(33, 66)).toBe("About 1 min");
    expect(formatEstimate(1680, 2160)).toBe("About 28–36 min");
    expect(formatEstimate(6000, 7800)).toBe("About 1 hr 40 min – 2 hr 10 min");
    expect(formatMonthDay("2026-09-24")).toBe("Sep 24");
  });

  it("名前の手がかり", () => {
    setLocale("en");
    expect(formatHints([{ name: "田中", sources: { 自己紹介: 2, 呼びかけ直後: 1 } }])).toBe("田中 (self-intro ×2, addressed ×1)");
  });
});
