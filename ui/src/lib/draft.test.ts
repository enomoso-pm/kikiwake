import { describe, expect, it } from "vitest";
import { getState, setState, resultInitial } from "../store/state";
import { draftOf, stateFromDraft } from "./draft";

const doneJob = {
  jobId: "5f1c2a9d0b7e4c31",
  path: "/Users/example/定例.m4a",
  outDir: "/Users/example/定例_文字起こし",
  status: "done" as const,
  stage: "merge" as const,
  percent: 100,
  etaSec: null,
  reused: false,
  startedAt: 0,
  endedAt: 0,
  error: null,
  diarizationKept: true,
  cancelRequested: false,
};

describe("閉じたときの状態（約束 版8）", () => {
  it("話者・文字起こしのタブでだけ作り、戻すと同じ手直しになる", () => {
    setState({
      ...resultInitial(),
      job: doneJob,
      screen: "result",
      names: { 話者A: "佐藤", 話者B: " 鈴木" },
      lineNames: { u3: "田中" },
      confirmed: { u3: true },
      textHistory: { u0: ["直した", "もう一度直した"] },
      hidden: { "\u0000名無し": true },
      formats: { md: true, txt: false, json: true },
      outDir: "/Users/example/Desktop/定例_文字起こし",
      saved: { files: ["/Users/example/Desktop/定例_文字起こし/transcript_named.md"] },
      savedEdits: "{\"x\":1}",
    });
    const d = draftOf(getState(), true);
    expect(d).toMatchObject({ screen: "result", unsaved: true, confirmed: ["u3"], formats: ["md", "json"], names: { 話者B: " 鈴木" } });
    const back = stateFromDraft(JSON.parse(JSON.stringify(d)));
    expect(back.lineNames).toEqual({ u3: "田中" });
    expect(back.confirmed).toEqual({ u3: true });
    expect(back.textHistory).toEqual({ u0: ["直した", "もう一度直した"] });
    expect(back.hidden).toEqual({ "\u0000名無し": true });
    expect(back.formats).toEqual({ md: true, txt: false, json: true });
    expect(back.outDir).toBe("/Users/example/Desktop/定例_文字起こし");
    expect(back.saved).toEqual({ files: ["/Users/example/Desktop/定例_文字起こし/transcript_named.md"] });
    expect(back.savedEdits).toBe("{\"x\":1}");

    // 話者のタブ（名前付け）はそのまま
    setState({ screen: "naming" });
    expect(draftOf(getState(), false)?.screen).toBe("naming");
    // 処理中・ほかの画面・処理が終わっていない録音では作らない
    setState({ screen: "processing" });
    expect(draftOf(getState(), false)).toBeNull();
    setState({ screen: "result", job: { ...doneJob, status: "running" } });
    expect(draftOf(getState(), false)).toBeNull();
  });

  it("欠けた・古い形でも戻せる（無い所は初めの状態）", () => {
    const back = stateFromDraft({ screen: "naming", unsaved: false });
    expect(back).toEqual({
      lineNames: {},
      confirmed: {},
      textHistory: {},
      hidden: {},
      savedEdits: null,
      saved: null,
      savedOnce: false,
      lastSaved: [],
    });
  });

  it("版12: 最後に保存したファイルは、保存したあとで名前を変えても残る。前の版の状態は保存したファイルの記録で", () => {
    const file = "/Users/example/定例_文字起こし.md";
    setState({ ...resultInitial(), job: doneJob, screen: "result", saved: null, savedOnce: true, lastSaved: [file] });
    const d = draftOf(getState(), true);
    expect(d?.savedFiles).toEqual([]);
    expect(d?.lastSavedFiles).toEqual([file]);
    expect(stateFromDraft(JSON.parse(JSON.stringify(d))).lastSaved).toEqual([file]);
    expect(stateFromDraft({ screen: "result", unsaved: false, savedFiles: ["/x/transcript.md"] }).lastSaved).toEqual(["/x/transcript.md"]);
  });

  it("版9: 保存したことがある（保存したあとで名前を変えて「保存しました」が消えても残る）。前の版の状態は保存したファイルの記録で", () => {
    setState({ ...resultInitial(), job: doneJob, screen: "result", saved: null, savedOnce: true });
    const d = draftOf(getState(), true);
    expect(d?.savedOnce).toBe(true);
    expect(stateFromDraft(JSON.parse(JSON.stringify(d))).savedOnce).toBe(true);
    expect(stateFromDraft({ screen: "result", unsaved: false, savedFiles: ["/x/transcript.md"] }).savedOnce).toBe(true);
    expect(stateFromDraft({ screen: "result", unsaved: false, savedFiles: [] }).savedOnce).toBe(false);
  });
});
