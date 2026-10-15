// 画面4 名前付け（UI 画面仕様書 §7）
import type { JobDraft, Names, ScreensInfo, TranscriptView } from "@contract/types";
import { api } from "../api";
import { stateFromDraft } from "../lib/draft";
import { toAppError } from "../lib/errors";
import { nameKey, namesForApply } from "../lib/names";
import { stopPlayback } from "../lib/player";
import { NO_NAME, getState, resultInitial, setState, type AppState } from "./state";
import { goTo } from "./ui";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 開いたときに確定していた名前（結果を読み込む前は、画面の確定した名前 appliedNames が空なので、ここで比べる） */
let openedNames: Names = {};

/**
 * 処理が終わった・履歴から開いた録音を画面に入れる。話者カードと確認用の手がかりを読んで名前付けへ（処理が終わったときは 0.5 秒おく。§2.3）。
 * 版6: この録音で前に確定した名前があれば、最初から入れておく（2026-09-26 決定）。
 * 版8: 閉じたときの状態（draft）があれば、入れかけた名前・手直しを戻し、閉じたときの画面（名前付け・結果）へ（2026-09-27 決定）。
 * 版9: savedBefore は一覧の「保存したことがある」（閉じたときの状態が無い・書き起こしが変わって返らないときも、保存した記録を残す）。
 * 文字起こしの中身は、どちらのタブで開くときも読み込む（2026-09-27 に直した: 話者のタブで開くと読み込んでいなかったので、
 * 保存したあとの手直しを数えられず、閉じたときの状態に「手直しなし」と書き直して、一覧の印が「保存後に手直し」から「保存済み」に戻っていた）
 */
export async function enterNaming(
  jobId: string,
  previousNames?: Names,
  draft?: JobDraft,
  immediate = false,
  savedBefore = false,
  screens?: ScreensInfo,
): Promise<void> {
  const t0 = Date.now();
  const applied: Names = previousNames ? { ...previousNames } : {};
  openedNames = { ...applied };
  const toResult = draft?.screen === "result";
  try {
    const [speakers, hints, view] = await Promise.all([
      api.getSpeakers(jobId),
      api.getUnresolvedHints(jobId).catch(() => []),
      api.getTranscript(jobId, Object.values(applied).some((v) => v.trim())),
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
      ...resultInitial(),
      outDir: s.job.outDir,
      view,
      appliedNames: applied,
      ...(draft ? stateFromDraft(draft) : {}),
      ...(savedBefore ? { savedOnce: true } : {}),
      screens: screens ?? null,
      screen: toResult ? "result" : "naming",
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

/**
 * 名前を確定して、実名版で結果の画面へ（§7.5）。確定できたら true。
 * show が false なら画面は移らない（「話者」のタブのまま保存する・「詳細」を開くとき、名前を確定してから）
 */
export async function applyNamesAndShow(show = true): Promise<boolean> {
  const s = getState();
  const jobId = s.job?.jobId;
  if (!jobId || s.applying) return false;
  const names = namesForApply(labelOrder(s), s.names);
  // 名前が前に確定したものと同じなら、保存したファイルはそのまま使える（「保存しました」を消さない。2026-09-27）
  const changed = !sameNames(names, s.view ? s.appliedNames : openedNames);
  setState({ applying: true, applyError: null });
  try {
    const view = await api.applyNames(jobId, names);
    if (show) stopPlayback();
    setState((st) => ({
      view,
      appliedNames: names,
      applying: false,
      ...(changed ? { saved: null } : {}),
      saveError: null,
      hidden: pruneHidden(st.hidden, view, st.lineNames),
      ...(show ? { screen: "result" as const, editing: null, nameMenu: null, detailOpen: false } : {}),
      outDir: st.outDir || st.job?.outDir || "",
    }));
    return true;
  } catch (e) {
    setState({ applying: false, applyError: toAppError(e) });
    return false;
  }
}

/** 入れた名前が、まだ確定されていないか（結果を読み込んでいない・確定した名前と違う） */
export function needsApply(s: AppState): boolean {
  return !s.view || !sameNames(namesForApply(labelOrder(s), s.names), s.appliedNames);
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

/**
 * 「話者」「文字起こし」の切り替え（前の形では工程バーの 4⇔5）。名前付けから結果へは、名前が変わっていれば確定し直す。
 * 名前が変わっていなければ「保存しました」は消さない（保存したファイルは今の中身のまま。2026-09-27 に直した:
 * 前は切り替えるだけで消え、一覧の印が「保存後に手直し」になっていた）
 */
export function navigateStep(target: "naming" | "result"): void {
  const s = getState();
  if (target === "naming") {
    goTo("naming");
    return;
  }
  if (needsApply(s)) {
    void applyNamesAndShow();
    return;
  }
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
