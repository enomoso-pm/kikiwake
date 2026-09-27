import { describe, expect, it } from "vitest";
import { formatHints, groupNames, nameKey, namesForApply } from "./names";

describe("名前のまとめ（§7.3・§13 Q4: 全角と半角の違いは同じとみなす）", () => {
  it("前後の空白（全角も）を除き、全角・半角をそろえて比べる", () => {
    expect(nameKey(" 佐藤　")).toBe("佐藤");
    expect(nameKey("Ｓａｔｏ")).toBe(nameKey("Sato"));
    expect(nameKey("ｻﾄｳ")).toBe(nameKey("サトウ"));
    expect(nameKey("sato")).not.toBe(nameKey("Sato"));
    expect(nameKey("　")).toBe("");
  });

  it("同じ名前のラベルは1人にまとまり、書き方は一覧で上のラベルにそろう", () => {
    const order = ["話者A", "話者C", "話者B", "話者E"];
    const names = { 話者A: "Sato", 話者C: "", 話者B: "鈴木", 話者E: " Ｓａｔｏ " };
    const g = groupNames(order, names);
    expect(g.groups.map((x) => [x.name, x.labels])).toEqual([
      ["Sato", ["話者A", "話者E"]],
      ["鈴木", ["話者B"]],
    ]);
    expect(g.unnamed).toEqual(["話者C"]);
    expect(namesForApply(order, names)).toEqual({ 話者A: "Sato", 話者B: "鈴木", 話者E: "Sato" });
  });

  it("名前をすべて空にしても進める（話者の数え方は「話者 10」。2026-09-27 に「ラベル」をやめた）", () => {
    const order = Array.from({ length: 10 }, (_, i) => `話者${String.fromCharCode(65 + i)}`);
    expect(groupNames(order, {}).unnamed).toHaveLength(10);
    expect(namesForApply(order, {})).toEqual({});
  });
});


describe("名前の手がかりの書き方（§7.3）", () => {
  it("「田中（自己紹介2・呼びかけ直後1）」の形。複数は「・」でつなぐ", () => {
    expect(formatHints([{ name: "田中", sources: { 呼びかけ直後: 1, 自己紹介: 2 } }])).toBe("田中（自己紹介2・呼びかけ直後1）");
    expect(
      formatHints([
        { name: "鈴木", sources: { 自己紹介: 1 } },
        { name: "高橋", sources: { 呼びかけ直後: 1 } },
      ]),
    ).toBe("鈴木（自己紹介1）・高橋（呼びかけ直後1）");
    expect(formatHints([])).toBeNull();
  });
});
