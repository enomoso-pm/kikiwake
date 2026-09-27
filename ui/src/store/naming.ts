// 画面4 名前付け（UI 画面仕様書 §7）
import type { JobDraft, Names, TranscriptView } from "@contract/types";
import { api } from "../api";
import { stateFromDraft } from "../lib/draft";
import { toAppError } from "../lib/errors";
import { nameKey, namesForApply } from "../lib/names";
import { stopPlayback } from "../lib/player";
import { NO_NAME, getState, resultInitial, setState, type AppState } from "./state";
import { goTo } from "./ui";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 処理が終わった・履歴から開いた録音を画面に入れる。話者カードと確認用の手がかりを読んで名前付けへ（処理が終わったときは 0.5 秒おく。§2.3）。
 * 版6: この録音で前に確定した名前があれば、最初から入れておく（2026-09-26 決定）。
 * 版8: 閉じたときの状態（draft）があれば、入れかけた名前・手直しを戻し、閉じたときの画面（名前付け・結果）へ（2026-09-27 決定）
 */
export async function enterNaming(jobId: string, previousNames?: Names, draft?: JobDraft, immediate = false): Promise<void> {
  const t0 = Date.now();
  const applied: Names = previousNames ? { ...previousNames } : {};
  const toResult = draft?.screen === "result";
  try {
    const [speakers, hints, view] = await Promise.all([
      api.getSpeakers(jobId),
      api.getUnresolvedHints(jobId).catch(() => []),
      toResult ? api.getTranscript(jobId, Object.values(applied).some((v) => v.trim())) : Promise.resolve(null),
    ]);
    const rest = 500 - (Date.now() - t0);
    if (!immediate && rest > 0) await wait(rest);
    const s = getState();
    if (s.job?.jobId !== jobId) return;
    // 画面を移るのと同じ1回で入れる（途中の状態を閉じたときの状態として書かないように。store/draft.ts）
    setState({
      speakers,
      hints,
      names: draft?.names ? { ...draft.names } : { ...applied },
      selectedLabel: speakers[0]?.label ?? null,
      applying: false,
      applyError: null,
      reachedResult: Boolean(view),
      ...resultInitial(),
      outDir: s.job.outDir,
      ...(view ? { view, appliedNames: applied } : {}),
      ...(draft ? stateFromDraft(draft) : {}),
      screen: view ? "result" : "naming",
      editing: null,
      nameMenu: null,
      detailOpen: false,
    });
    stopPlayback();
  } catch (e) {
    setState((s) =>
      s.job && s.job.jobId === jobId
        ? { job: { ...s.job, status: "failed", error: toAppError(e), diarizationKept: true, endedAt: Date.now() } }
        : {},
    );
  }
}

export function labelOrder(s: AppState): string[] {
  return s.speakers.map((c) => c.label);
}

export function selectLabel(label: string): void {
  stopPlayback();
  setState({ selectedLabel: label });
}

/** 前の話者・次の話者（端まで行ったら反対の端へ回る） */
export function stepLabel(delta: 1 | -1): void {
  const s = getState();
  const order = labelOrder(s);
  if (!order.length) return;
  const i = Math.max(0, order.indexOf(s.selectedLabel ?? order[0]));
  selectLabel(order[(i + delta + order.length) % order.length]);
}

export function setName(label: string, value: string): void {
  setState((s) => ({ names: { ...s.names, [label]: value } }));
}

function sameNames(a: Names, b: Names): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** 名前を確定して、実名版で結果の画面へ（§7.5） */
export async function applyNamesAndShow(): Promise<void> {
  const s = getState();
  const jobId = s.job?.jobId;
  if (!jobId || s.applying) return;
  const names = namesForApply(labelOrder(s), s.names);
  setState({ applying: true, applyError: null });
  try {
    const view = await api.applyNames(jobId, names);
    stopPlayback();
    setState((st) => ({
      view,
      appliedNames: names,
      applying: false,
      reachedResult: true,
      saved: null,
      saveError: null,
      hidden: pruneHidden(st.hidden, view, st.lineNames),
      screen: "result",
      editing: null,
      nameMenu: null,
      detailOpen: false,
      outDir: st.outDir || st.job?.outDir || "",
    }));
  } catch (e) {
    setState({ applying: false, applyError: toAppError(e) });
  }
}

/** 名前付けで名前を変えて、前の名前が無くなったら、その名前の表示の記録は捨てる（§8.4） */
function pruneHidden(hidden: AppState["hidden"], view: TranscriptView, lineNames: Record<string, string>) {
  const present = new Set<string>([NO_NAME]);
  view.utterances.forEach((u) => present.add(nameKey(u.speaker)));
  Object.values(lineNames).forEach((n) => present.add(nameKey(n)));
  const out: AppState["hidden"] = {};
  Object.keys(hidden).forEach((k) => {
    if (present.has(k)) out[k] = true;
  });
  return out;
}

/** 工程バーの 4⇔5。名前付けから結果へは、名前が変わっていれば確定し直す */
export function navigateStep(target: "naming" | "result"): void {
  const s = getState();
  if (target === "naming") {
    goTo("naming");
    return;
  }
  const names = namesForApply(labelOrder(s), s.names);
  if (!s.view || !sameNames(names, s.appliedNames)) {
    void applyNamesAndShow();
    return;
  }
  setState({ saved: null });
  goTo("result");
}

/** 結果の画面の詳細から、その名前のラベルを選んで名前付けへ（まとめなら最初のラベル） */
export function goToNamingFor(name: string | null): void {
  const s = getState();
  if (name) {
    const k = nameKey(name);
    const label = labelOrder(s).find((l) => nameKey(s.appliedNames[l] || l) === k);
    if (label) setState({ selectedLabel: label });
  }
  goTo("naming");
}
