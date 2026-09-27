// 閉じたときの状態を作業フォルダに置く（約束 版8 の saveDraft。2026-09-27 決定）。
// 変わるたびにすぐ書く（書いている間にまた変わったら、書き終えてからもう一度）。閉じる前の確かめはしないので、待たずに書く
import { api } from "../api";
import { draftOf } from "../lib/draft";
import { changedSinceSave } from "./result";
import { useApp, type AppState } from "./state";

let writing = false;
let pending: { jobId: string; body: string } | null = null;
let last = "";

async function flush(): Promise<void> {
  if (writing || !pending) return;
  writing = true;
  const { jobId, body } = pending;
  pending = null;
  try {
    await api.saveDraft(jobId, JSON.parse(body));
    last = `${jobId}\n${body}`;
  } catch {
    // 書けなくても画面は動く（開き直したときに、閉じたときの状態に戻らないだけ）
  }
  writing = false;
  void flush();
}

/** 閉じたときの状態に関わる所が変わったか（検索の入力・音の再生などでは書かない） */
function changed(s: AppState, p: AppState): boolean {
  return (
    s.screen !== p.screen ||
    s.job !== p.job ||
    s.names !== p.names ||
    s.lineNames !== p.lineNames ||
    s.confirmed !== p.confirmed ||
    s.textHistory !== p.textHistory ||
    s.hidden !== p.hidden ||
    s.formats !== p.formats ||
    s.outDir !== p.outDir ||
    s.saved !== p.saved ||
    s.savedOnce !== p.savedOnce ||
    s.savedEdits !== p.savedEdits ||
    s.appliedNames !== p.appliedNames ||
    s.view !== p.view
  );
}

export function watchDraft(): void {
  useApp.subscribe((s, prev) => {
    if (!changed(s, prev)) return;
    const jobId = s.job?.jobId;
    const draft = draftOf(s, changedSinceSave(s));
    if (!jobId || !draft) return;
    const body = JSON.stringify(draft);
    if (`${jobId}\n${body}` === last || (pending?.jobId === jobId && pending.body === body)) return;
    pending = { jobId, body };
    void flush();
  });
}
