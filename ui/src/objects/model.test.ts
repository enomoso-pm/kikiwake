import { describe, expect, it } from "vitest";
import type { HistoryItem } from "@contract/types";
import type { JobView } from "../store/state";
import { buildEntries, mergeOrder, namedOf, namedSpeakersOf, peopleOf, samePath, shownPeople, sourceOf, statusOf, volumeOf, type Entry } from "./model";

function item(jobId: string, over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    jobId,
    name: `${jobId}.m4a`,
    path: `/Users/example/Movies/${jobId}.m4a`,
    durationSec: 60,
    processedAt: "2026-09-27",
    status: "done",
    speakers: 2,
    named: true,
    unsavedEdits: false,
    sourceAvailable: true,
    diarizationKept: true,
    sourceState: "ok",
    saved: false,
    ...over,
  };
}

function running(path: string, over: Partial<JobView> = {}): JobView {
  return {
    jobId: "run1",
    path,
    outDir: "",
    status: "running",
    stage: "transcribe",
    percent: 42.7,
    etaSec: null,
    reused: false,
    startedAt: 0,
    endedAt: null,
    error: null,
    diarizationKept: false,
    cancelRequested: false,
    ...over,
  };
}

const history = (h: HistoryItem[]): Entry[] => h.map((x) => ({ kind: "history", key: `h:${x.jobId}`, item: x }));

describe("一覧の並び（mergeOrder）", () => {
  it("前に並べた順を保ち、新しい録音だけ一番上に足す", () => {
    // エンジンは最後に使った順（b を手直しすると b が上に来る）でも、一覧の行は動かない
    expect(mergeOrder(["a", "b", "c"], [item("b"), item("a"), item("c")])).toEqual(["a", "b", "c"]);
    expect(mergeOrder(["a", "b"], [item("n"), item("a"), item("b")])).toEqual(["n", "a", "b"]);
  });
  it("消えた録音は並びから外す", () => {
    expect(mergeOrder(["a", "b", "c"], [item("a"), item("c")])).toEqual(["a", "c"]);
  });
});

describe("一覧に並べるもの（buildEntries）", () => {
  it("処理中 → 順番待ち → 履歴（並べた順）", () => {
    const e = buildEntries(
      running("/x/run.m4a"),
      "run.m4a",
      60,
      [{ id: "q1", path: "/x/q.m4a", name: "q.m4a", durationSec: 30 }],
      [item("b"), item("a")],
      ["a", "b"],
    );
    expect(e.map((x) => x.key)).toEqual(["run", "q:q1", "h:a", "h:b"]);
  });
  it("続きから処理している・順番待ちにした途中の録音は、履歴の行を出さない（同じ録音を2行にしない）", () => {
    const unfinished = item("u", { status: "unfinished", path: "/x/u.m4a" });
    const e1 = buildEntries(running("/x/u.m4a", { jobId: null }), "u.m4a", 60, [], [unfinished], ["u"]);
    expect(e1.map((x) => x.key)).toEqual(["run"]);
    const e2 = buildEntries(null, "", 0, [{ id: "q1", path: "/x/u.m4a", name: "u.m4a", durationSec: 60 }], [unfinished], ["u"]);
    expect(e2.map((x) => x.key)).toEqual(["q:q1"]);
  });
  it("書き終えた録音は、同じ場所のファイルを処理していても別の録音として残す（変わったファイルを新しく文字起こし）", () => {
    const done = item("d", { path: "/x/d.m4a" });
    const e = buildEntries(running("/x/d.m4a"), "d.m4a", 60, [], [done], ["d"]);
    expect(e.map((x) => x.key)).toEqual(["run", "h:d"]);
  });
  it("止まった処理は処理中として並べない", () => {
    expect(buildEntries(running("/x/a.m4a", { status: "failed" }), "a", 0, [], [], []).length).toBe(0);
  });
});

describe("状態の印（statusOf。保存を軸にした6つ）", () => {
  const [e] = history([item("a")]);
  it("処理中は文字起こしの％（声を文字にする段階だけ）", () => {
    const run: Entry = { kind: "running", key: "run", name: "r", path: "/r", durationSec: 0, job: running("/r") };
    expect(statusOf(run, null)).toEqual({ id: "running", percent: 42 });
    const diar: Entry = { ...run, job: running("/r", { stage: "diarize" }) } as Entry;
    expect(statusOf(diar, null)).toEqual({ id: "running", percent: null });
  });
  it("名前の有無は印にしない（名前を付けなくても保存できる）: 保存前 → 保存済み → 保存後に手直し、止まったら中断", () => {
    expect(statusOf(history([item("a", { named: false })])[0], null).id).toBe("notSaved");
    expect(statusOf(e, null).id).toBe("notSaved");
    expect(statusOf(history([item("a", { saved: true })])[0], null).id).toBe("saved");
    expect(statusOf(history([item("a", { saved: true, unsavedEdits: true })])[0], null).id).toBe("editedAfterSave");
    expect(statusOf(history([item("a", { status: "unfinished" })])[0], null).id).toBe("stopped");
  });
  it("保存したあとで名前を変えた（画面の「保存しました」は消える）録音も、保存したことを覚えていれば「保存後に手直し」", () => {
    expect(statusOf(e, { named: true, savedOnce: true, savedNow: false }).id).toBe("editedAfterSave");
  });
  it("開いている録音は画面の今の値で決める。数えられない値（null）は一覧の値を使う", () => {
    expect(statusOf(e, { named: true, savedOnce: true, savedNow: true }).id).toBe("saved");
    expect(statusOf(e, { named: true, savedOnce: true, savedNow: false }).id).toBe("editedAfterSave");
    expect(statusOf(e, { named: false, savedOnce: false, savedNow: false }).id).toBe("notSaved");
    expect(statusOf(history([item("a", { saved: true, unsavedEdits: true })])[0], { named: null, savedOnce: true, savedNow: null }).id).toBe("editedAfterSave");
  });
  it("名前が付いているか（録音の情報として出す）", () => {
    expect(namedOf(history([item("a", { named: false })])[0], null)).toBe(false);
    expect(namedOf(e, { named: false, savedOnce: false, savedNow: null })).toBe(false);
    expect(namedOf(e, { named: null, savedOnce: false, savedNow: null })).toBe(true);
  });
});

describe("付けた名前（約束 版9 の namedSpeakers。一覧の行に「松本・田中ほか2人」）", () => {
  it("発言の多い順に2人と、残りの人数（名前を付けていない話者も数える）", () => {
    expect(shownPeople({ names: ["松本", "田中", "佐藤", "鈴木"], unnamed: 0 })).toEqual({ shown: ["松本", "田中"], rest: 2 });
    expect(shownPeople({ names: ["松本"], unnamed: 3 })).toEqual({ shown: ["松本"], rest: 3 });
    expect(shownPeople({ names: ["佐々木", "高橋"], unnamed: 0 })).toEqual({ shown: ["佐々木", "高橋"], rest: 0 });
  });
  it("開いている録音は、結果の画面の発言時間（名前でまとめた・多い順）と確定した名前から作る", () => {
    const talk = [
      { speaker: "松本", sec: 35, share: 0.5 },
      { speaker: "田中", sec: 30, share: 0.43 },
      { speaker: "話者C", sec: 5, share: 0.07 },
    ];
    expect(namedSpeakersOf(talk, { 話者A: "松本", 話者B: "田中", 話者D: "松本" })).toEqual({ names: ["松本", "田中"], unnamed: 1 });
    expect(namedSpeakersOf(talk, { 話者A: " " })).toBeNull();
  });
  it("開いている録音は画面の今の値、読み込む前（undefined）は一覧の値、名前を消したら（null）出さない", () => {
    const [e] = history([item("a", { namedSpeakers: { names: ["松本"], unnamed: 1 } })]);
    expect(peopleOf(e, null)).toEqual({ names: ["松本"], unnamed: 1 });
    expect(peopleOf(e, { named: null, savedOnce: false, savedNow: null })).toEqual({ names: ["松本"], unnamed: 1 });
    expect(peopleOf(e, { named: false, savedOnce: false, savedNow: null, people: null })).toBeNull();
    expect(peopleOf(e, { named: true, savedOnce: false, savedNow: null, people: { names: ["田中"], unnamed: 0 } })).toEqual({ names: ["田中"], unnamed: 0 });
  });
});

describe("元のファイル", () => {
  it("約束 版9 の sourceState（見つからない・変わったを分ける）", () => {
    expect(sourceOf(history([item("a")])[0], null)).toBe("ok");
    expect(sourceOf(history([item("a", { sourceAvailable: false, sourceState: "missing" })])[0], null)).toBe("missing");
    expect(sourceOf(history([item("a", { sourceAvailable: false, sourceState: "changed" })])[0], null)).toBe("changed");
  });
  it("開いている録音は、再生できると分かっていれば ok（結び直した直後など、一覧の読み直し前）", () => {
    const [e] = history([item("a", { sourceAvailable: false, sourceState: "changed" })]);
    expect(sourceOf(e, true)).toBe("ok");
    expect(sourceOf(e, null)).toBe("changed");
  });
  it("外付けのドライブの名前（Mac の /Volumes/〈名前〉/）", () => {
    expect(volumeOf("/Volumes/外付け/インタビュー/a.mp4")).toBe("外付け");
    expect(volumeOf("/Users/example/a.mp4")).toBeNull();
  });
  it("場所の比べ方は / と \\ と末尾の区切りを同じとみなす", () => {
    expect(samePath("C:\\Users\\a\\b.m4a", "C:/Users/a/b.m4a")).toBe(true);
    expect(samePath("/a/b/", "/a/b")).toBe(true);
    expect(samePath("/a/b", "/a/c")).toBe(false);
  });
});
