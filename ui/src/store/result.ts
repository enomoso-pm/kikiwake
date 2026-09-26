// 画面5 結果（UI 画面仕様書 §8）。行ごとの名前・確認用の確定・直した文字は画面が持ち、保存のときに渡す（約束 版3）
import type { SaveFormat } from "@contract/types";
import { api } from "../api";
import { toAppError } from "../lib/errors";
import { cleanName, nameKey } from "../lib/names";
import { buildEdits, buildRows, menuNames, normalizeEditedText } from "../lib/transcript";
import { NO_NAME, getState, setState, type AppState } from "./state";
import { showToast } from "./ui";

export function rowsOf(s: AppState) {
  return s.view ? buildRows(s.view, s.lineNames, s.confirmed, s.textHistory) : [];
}

/** 手直し（行の名前・確認用の確定・文字）を、比べられる文字にしたもの。手直しが無ければ null */
export function editsSignature(s: AppState): string | null {
  const edits = buildEdits(rowsOf(s));
  return edits ? JSON.stringify({ names: s.appliedNames, edits }) : null;
}

/** 保存していない手直しがあるか（最後に保存したときと比べる） */
export function hasUnsavedEdits(s: AppState): boolean {
  const sig = editsSignature(s);
  return sig !== null && sig !== s.savedEdits;
}

function isUnresolved(s: AppState, id: string): boolean {
  return Boolean(s.view?.unresolved.some((l) => l.id === id));
}

function labelNameOf(s: AppState, id: string): string | null {
  return s.view?.utterances.find((l) => l.id === id)?.speaker ?? null;
}

// ---- 検索 ------------------------------------------------------------------------

export function setSearch(search: string): void {
  setState({ search, matchIndex: 0 });
}

export function moveMatch(delta: 1 | -1): void {
  setState((s) => ({ matchIndex: s.matchIndex + delta }));
}

// ---- 表示する人 ---------------------------------------------------------------------

export function peopleKey(name: string | null): string {
  return name ? nameKey(name) : NO_NAME;
}

export function toggleHidden(name: string | null): void {
  const k = peopleKey(name);
  setState((s) => {
    const hidden = { ...s.hidden };
    if (hidden[k]) delete hidden[k];
    else hidden[k] = true;
    return { hidden };
  });
}

export function showAllPeople(): void {
  setState({ hidden: {} });
}

// ---- 文字の手直し（§8.5.3） ----------------------------------------------------------

export function startEditText(id: string): void {
  const s = getState();
  if (s.editing?.id === id) return;
  if (s.editing) commitEdit();
  const row = rowsOf(getState()).find((r) => r.id === id);
  if (row) setState({ editing: { id, value: row.text }, nameMenu: null });
}

export function setEditValue(value: string): void {
  setState((s) => (s.editing ? { editing: { ...s.editing, value } } : {}));
}

/** 決める: 改行は空白に、前後の空白を除く。空や今と同じなら何も変えない */
export function commitEdit(): void {
  const s = getState();
  const ed = s.editing;
  if (!ed) return;
  const value = normalizeEditedText(ed.value);
  const row = rowsOf(s).find((r) => r.id === ed.id);
  if (!row || !value || value === row.text) {
    setState({ editing: null });
    return;
  }
  setState((st) => ({
    editing: null,
    textHistory: { ...st.textHistory, [ed.id]: [...(st.textHistory[ed.id] ?? []), value] },
  }));
}

export function cancelEdit(): void {
  setState({ editing: null });
}

/** 1つ戻す: 履歴の最後を消す。空になったら元の文字 */
export function undoText(id: string): void {
  setState((s) => {
    const hist = (s.textHistory[id] ?? []).slice(0, -1);
    const textHistory = { ...s.textHistory };
    if (hist.length) textHistory[id] = hist;
    else delete textHistory[id];
    return { textHistory };
  });
}

export function requestRevertAll(): void {
  setState({ dialog: "revertAll" });
}

export function revertAllTexts(): void {
  setState({ dialog: null, textHistory: {}, editing: null });
  showToast("元の文字に戻しました");
}

// ---- 名前を選ぶ欄（§8.6） -----------------------------------------------------------

export function openNameMenu(id: string, rect: { left: number; top: number; bottom: number }): void {
  const s = getState();
  if (s.editing) commitEdit();
  setState({ nameMenu: { id, anchor: { left: rect.left, top: rect.top, bottom: rect.bottom }, value: "" } });
}

export function setMenuValue(value: string): void {
  setState((s) => (s.nameMenu ? { nameMenu: { ...s.nameMenu, value } } : {}));
}

export function closeNameMenu(): void {
  setState({ nameMenu: null });
}

/** 入力した名前が、すでにある名前（全角・半角の違いだけ）なら、その書き方にそろえる */
function canonicalName(s: AppState, name: string): string {
  const { labelNames, freeNames } = menuNames(
    s.speakers.map((c) => c.label),
    s.appliedNames,
    s.lineNames,
  );
  return [...labelNames, ...freeNames].find((n) => nameKey(n) === nameKey(name)) ?? name;
}

/** その行の名前に決める。ラベルの名前と同じなら行ごとの名前を消す（ラベルの名前は変えない） */
export function chooseLineName(id: string, raw: string): void {
  const s = getState();
  const typed = cleanName(raw);
  if (!typed) return;
  const name = canonicalName(s, typed);
  const labelName = isUnresolved(s, id) ? null : labelNameOf(s, id);
  const lineNames = { ...s.lineNames };
  if (labelName !== null && nameKey(name) === nameKey(labelName)) delete lineNames[id];
  else lineNames[id] = name;
  setState({ lineNames, nameMenu: null });
}

/** ラベルの名前に戻す（ふつうの行）／名無しに戻す（確認用の行。確定も取り消す） */
export function resetLineName(id: string): void {
  setState((s) => {
    const lineNames = { ...s.lineNames };
    const confirmed = { ...s.confirmed };
    delete lineNames[id];
    delete confirmed[id];
    return { lineNames, confirmed, nameMenu: null };
  });
}

// ---- 確認用の欄（§8.7） ---------------------------------------------------------------

let flashTimer = 0;
let scrollSeq = 0;

/** 本文のその行へ移る（一覧が上から3分の1あたりに流し、1.6 秒光らせる）。openMenu なら名前を選ぶ欄も開く */
export function jumpToLine(id: string, openMenu: boolean): void {
  const s = getState();
  const row = rowsOf(s).find((r) => r.id === id);
  if (!row) return;
  const hidden = { ...s.hidden };
  delete hidden[peopleKey(row.name)];
  clearTimeout(flashTimer);
  setState({ hidden, flashId: id, nameMenu: null, scrollRequest: { id, seq: ++scrollSeq, openMenu } });
  flashTimer = window.setTimeout(() => setState({ flashId: null }), 1600);
}

/** 繰り返しの帯（約束 版4）: その時刻の行へ移る */
export function jumpToTime(sec: number): void {
  const s = getState();
  const rows = rowsOf(s).filter((r) => !s.hidden[peopleKey(r.name)]);
  const target = rows.find((r) => r.end > sec) ?? rows[rows.length - 1];
  if (target) jumpToLine(target.id, false);
}

/** 名前を入れた確認用の行を確定して、一覧から外す */
export function confirmNamedUnresolved(): void {
  const s = getState();
  const ids = rowsOf(s)
    .filter((r) => r.pending && r.name)
    .map((r) => r.id);
  if (!ids.length) return;
  const confirmed = { ...s.confirmed };
  ids.forEach((id) => {
    confirmed[id] = true;
  });
  setState({ confirmed });
  showToast(`${ids.length}件を確定しました`);
}

// ---- 詳細 --------------------------------------------------------------------------

export function openDetail(): void {
  setState({ detailOpen: true, nameMenu: null });
}

export function closeDetail(): void {
  setState({ detailOpen: false });
}

// ---- 保存（§8.9。ファイル名は Python 版と同じ。同じ名前があればいつも確かめる） ------------------------

export function toggleFormat(f: SaveFormat): void {
  setState((s) => ({ formats: { ...s.formats, [f]: !s.formats[f] }, saved: null }));
}

export async function changeOutDir(): Promise<void> {
  try {
    const dir = await api.pickFolder(getState().outDir || undefined);
    if (dir) setState({ outDir: dir, saved: null });
  } catch (e) {
    setState({ saveError: toAppError(e) });
  }
}

export async function save(overwrite = false): Promise<void> {
  const s = getState();
  const jobId = s.job?.jobId;
  const formats = (["md", "txt", "json"] as const).filter((f) => s.formats[f]);
  if (!jobId || s.saving || !formats.length) return;
  setState({ saving: true, saveError: null, dialog: null, overwrite: null });
  try {
    const res = await api.saveOutputs(jobId, {
      dir: s.outDir,
      formats: [...formats],
      edits: buildEdits(rowsOf(s)),
      ...(overwrite ? { overwrite: true } : {}),
    });
    if (res.existing?.length && !overwrite) {
      setState({ saving: false, overwrite: res.existing, dialog: "overwrite" });
      return;
    }
    setState({ saving: false, saved: { files: res.files }, savedEdits: editsSignature(s) });
  } catch (e) {
    setState({ saving: false, saveError: toAppError(e) });
  }
}

export function cancelOverwrite(): void {
  setState({ dialog: null, overwrite: null });
}

export async function revealSaved(): Promise<void> {
  const s = getState();
  try {
    await api.revealInFileManager(s.saved?.files[0] ?? s.outDir);
  } catch (e) {
    setState({ saveError: toAppError(e) });
  }
}
