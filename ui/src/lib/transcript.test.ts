import { describe, expect, it } from "vitest";
import type { LineEdits, TranscriptView } from "@contract/types";
import editsExample from "@contract/fixtures/edits_example.json";
import transcriptNamed from "@contract/fixtures/transcript_named.json";
import {
  buildEdits,
  buildRows,
  highlightParts,
  menuNames,
  normalizeEditedText,
  peopleOf,
  resultStats,
  searchMatches,
  talkTimes,
} from "./transcript";

const view = () => structuredClone(transcriptNamed) as unknown as TranscriptView;

describe("結果の画面の行", () => {
  it("本文と確認用を時刻順に並べ、確認用はまだ確定していない「名無し」", () => {
    const v = view();
    const rows = buildRows(v, {}, {}, {});
    expect(rows).toHaveLength(v.utterances.length + v.unresolved.length);
    expect(rows.map((r) => r.start)).toEqual([...rows.map((r) => r.start)].sort((a, b) => a - b));
    const u2 = rows.find((r) => r.id === "u2");
    expect(u2).toMatchObject({ unresolved: true, pending: true, name: null });
    expect(rows.find((r) => r.id === "u0")).toMatchObject({ name: "松本", overridden: false });
  });

  it("手直しが無ければ、発言時間はエンジンの値のまま", () => {
    const v = view();
    const talk = talkTimes(v, buildRows(v, {}, {}, {}));
    expect(talk.map((t) => [t.name, t.sec])).toEqual(v.talkTime.map((t) => [t.speaker, t.sec]));
    expect(talk.reduce((a, t) => a + t.share, 0)).toBeCloseTo(1, 6);
  });

  it("行ごとの名前と確定した確認用の行で数え直す", () => {
    const v = view();
    const u8 = v.utterances.find((u) => u.id === "u8")!;
    const u2 = v.unresolved.find((u) => u.id === "u2")!;
    const rows = buildRows(v, { u8: "鈴木（デザイナー）", u2: "田中" }, { u2: true }, {});
    const talk = Object.fromEntries(talkTimes(v, rows).map((t) => [t.name, t.sec]));
    const base = Object.fromEntries(v.talkTime.map((t) => [t.speaker, t.sec]));
    expect(talk[u8.speaker]).toBeCloseTo(base[u8.speaker] - (u8.end - u8.start), 6);
    expect(talk["鈴木（デザイナー）"]).toBeCloseTo(u8.end - u8.start, 6);
    expect(talk["田中"]).toBeCloseTo(base["田中"] + (u2.end - u2.start), 6);
  });

  it("確定していない確認用の行の名前は、発言時間に入れない", () => {
    const v = view();
    const talk = talkTimes(v, buildRows(v, { u2: "田中" }, {}, {}));
    expect(talk.find((t) => t.name === "田中")?.sec).toBeCloseTo(v.talkTime.find((t) => t.speaker === "田中")!.sec, 6);
  });

  it("保存に渡す手直しは、約束の作例（edits_example.json）と同じ形になる", () => {
    const v = view();
    const ex = editsExample as LineEdits;
    const history = Object.fromEntries(Object.entries(ex.texts ?? {}).map(([id, t]) => [id, [t]]));
    const rows = buildRows(v, ex.names ?? {}, Object.fromEntries((ex.confirmed ?? []).map((id) => [id, true as const])), history);
    const edits = buildEdits(rows);
    expect(edits?.names).toEqual(ex.names);
    expect(edits?.confirmed).toEqual(ex.confirmed);
    expect(edits?.texts).toEqual(ex.texts);
    expect(buildEdits(buildRows(v, {}, {}, {}))).toBeUndefined();
  });

  it("ラベルの名前と同じ名前は、行ごとの名前として渡さない", () => {
    const v = view();
    const rows = buildRows(v, { u0: "松本" }, {}, {});
    expect(rows.find((r) => r.id === "u0")?.overridden).toBe(false);
    expect(buildEdits(rows)).toBeUndefined();
  });

  it("表示する人・名前を選ぶ欄・数", () => {
    const v = view();
    const rows = buildRows(v, { u8: "鈴木（デザイナー）" }, {}, { u0: ["直した文"] });
    const people = peopleOf(rows, talkTimes(v, rows));
    expect(people.names).toContain("鈴木（デザイナー）");
    expect(people.hasNoName).toBe(true);
    const menu = menuNames(["話者A", "話者C", "話者B", "話者D", "話者E"], { 話者A: "松本", 話者C: "田中", 話者B: "佐藤", 話者D: "鈴木" }, { u8: "鈴木（デザイナー）", u9: "松本" });
    expect(menu.labelNames).toEqual(["松本", "田中", "佐藤", "鈴木", "話者E"]);
    expect(menu.freeNames).toEqual(["鈴木（デザイナー）"]);
    const stats = resultStats(rows);
    expect(stats).toMatchObject({ rows: rows.length, editedRows: 1, renamedRows: 1, pending: 1, confirmed: 0 });
  });
});

describe("検索と手直しの文字", () => {
  it("大文字と小文字を区別せず、1行は1件", () => {
    const v = view();
    const rows = buildRows(v, {}, {}, {});
    const hits = searchMatches(rows, "api");
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits).size).toBe(hits.length);
    expect(searchMatches(rows, "  ")).toEqual([]);
    expect(highlightParts("APIとapi", "api")).toEqual([
      { text: "API", hit: true },
      { text: "と", hit: false },
      { text: "api", hit: true },
    ]);
  });

  it("改行は空白に、前後の空白は除く", () => {
    expect(normalizeEditedText("  一行目\n二行目\r\n三行目 ")).toBe("一行目 二行目 三行目");
  });
});
