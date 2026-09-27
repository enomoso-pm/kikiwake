// 閉じたときの状態（約束 版8 の JobDraft）: 画面の状態 ⇄ 作業フォルダに置く形。
// 2026-09-27 決定: 閉じても・別の録音へ移っても消えず、開き直す（履歴から・同じファイルを選び直す）と閉じたときの画面に戻る。
// 形は画面が決める（エンジンは中身を見ずに置いて返す。unsaved だけ履歴の一覧で使う）
import type { JobDraft, SaveFormat } from "@contract/types";
import type { AppState } from "../store/state";

const FORMATS: readonly SaveFormat[] = ["md", "txt", "json"];

/**
 * 画面の状態から、閉じたときの状態を作る。処理が終わった録音の名前付け・結果・完了の画面にいるときだけ（ほかは null）。
 * unsaved はファイルに保存していない手直しがあるか（store/result の hasUnsavedEdits）
 */
export function draftOf(s: AppState, unsaved: boolean): JobDraft | null {
  if (!s.job?.jobId || s.job.status !== "done") return null;
  if (s.screen !== "naming" && s.screen !== "result" && s.screen !== "done") return null;
  return {
    screen: s.screen === "naming" ? "naming" : "result",
    unsaved,
    names: { ...s.names },
    lineNames: { ...s.lineNames },
    confirmed: Object.keys(s.confirmed),
    textHistory: { ...s.textHistory },
    hidden: Object.keys(s.hidden),
    formats: FORMATS.filter((f) => s.formats[f]),
    outDir: s.outDir,
    savedEdits: s.savedEdits,
    savedFiles: s.saved?.files ?? [],
  };
}

/** 閉じたときの状態を、画面の状態に戻す（名前付けで入れかけた名前は別に戻す。store/naming の enterNaming） */
export function stateFromDraft(d: JobDraft): Partial<AppState> {
  const out: Partial<AppState> = {
    lineNames: { ...(d.lineNames ?? {}) },
    confirmed: Object.fromEntries((d.confirmed ?? []).map((id) => [id, true as const])),
    textHistory: Object.fromEntries(Object.entries(d.textHistory ?? {}).filter(([, h]) => Array.isArray(h) && h.length > 0)),
    hidden: Object.fromEntries((d.hidden ?? []).map((k) => [k, true as const])),
    savedEdits: d.savedEdits ?? null,
    saved: d.savedFiles?.length ? { files: [...d.savedFiles] } : null,
  };
  if (d.formats?.length) out.formats = { md: d.formats.includes("md"), txt: d.formats.includes("txt"), json: d.formats.includes("json") };
  if (d.outDir) out.outDir = d.outDir;
  return out;
}
