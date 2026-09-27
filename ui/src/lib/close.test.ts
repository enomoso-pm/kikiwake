import { describe, expect, it } from "vitest";
import { closeCase } from "./close";

describe("処理中に閉じるときの本文", () => {
  it("声の聞き分けが済む前は、途中の分を破棄して最初から", () => {
    expect(closeCase("extract", false)).toBe("beforeSeparation");
    expect(closeCase("diarize", false)).toBe("beforeSeparation");
  });
  it("前回の聞き分けを使い回しているなら、音声を取り出している間も聞き分けは残る", () => {
    expect(closeCase("extract", true)).toBe("converting");
    expect(closeCase("diarize", true)).toBe("converting");
  });
  it("声を文字にしている間は、聞き分けだけ残る", () => {
    expect(closeCase("transcribe", false)).toBe("converting");
  });
  it("まとめている間は、文字にした結果まで残る", () => {
    expect(closeCase("merge", false)).toBe("finishing");
    expect(closeCase("merge", true)).toBe("finishing");
  });
});
