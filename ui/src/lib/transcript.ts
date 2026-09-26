// 結果の画面の行と数え直し（UI 画面仕様書 §8）。画面の状態から毎回作り直す（行の数は数千まで）
import type { LineEdits, Names, TranscriptView } from "@contract/types";
import { FREE_NAME_COLOR } from "./colors";
import { countChars } from "./format";
import { cleanName, nameKey } from "./names";

export interface Row {
  id: string;
  start: number;
  end: number;
  overlap: boolean;
  /** 確認用（話者を決められなかった部分）から来た行 */
  unresolved: boolean;
  /** 確認用で、まだ確定していない */
  pending: boolean;
  /** ラベルの名前（名前付けで付けた名前。無ければ「話者A」）。確認用は null */
  labelName: string | null;
  /** その行だけの名前（確認用の行に付けた名前もここ） */
  override: string | null;
  /** 表示する名前。null は「名無し」 */
  name: string | null;
  /** ふつうの行で、ラベルの名前と違う名前にしてある */
  overridden: boolean;
  original: string;
  /** 直した後の文字 */
  text: string;
  history: string[];
}

const idNumber = (id: string) => Number(id.replace(/\D+/g, "")) || 0;

export function buildRows(
  view: TranscriptView,
  lineNames: Record<string, string>,
  confirmed: Record<string, true>,
  textHistory: Record<string, string[]>,
): Row[] {
  const rows: Row[] = [];
  const push = (unresolved: boolean) => (l: TranscriptView["utterances"][number]) => {
    const override = cleanName(lineNames[l.id]) || null;
    const labelName = unresolved ? null : l.speaker;
    const history = textHistory[l.id] ?? [];
    rows.push({
      id: l.id,
      start: l.start,
      end: l.end,
      overlap: l.overlap,
      unresolved,
      pending: unresolved && !confirmed[l.id],
      labelName,
      override,
      name: override ?? labelName,
      overridden: !unresolved && override !== null && nameKey(override) !== nameKey(labelName ?? ""),
      original: l.text,
      text: history.length ? history[history.length - 1] : l.text,
      history,
    });
  };
  view.utterances.forEach(push(false));
  view.unresolved.forEach(push(true));
  return rows.sort((a, b) => a.start - b.start || a.end - b.end || idNumber(a.id) - idNumber(b.id));
}

export interface TalkRow {
  name: string;
  sec: number;
  share: number;
}

/**
 * 話者ごとの発言時間（§8.8）。talkTime（話者判定の区間から数えた値）を基にし、
 * 行ごとの名前と確定した確認用の行を反映して数え直す。割合の分母は数え直した合計
 */
export function talkTimes(view: TranscriptView, rows: Row[]): TalkRow[] {
  const sec = new Map<string, number>();
  const spelling = new Map<string, string>();
  const add = (name: string, d: number) => {
    const k = nameKey(name);
    if (!spelling.has(k)) spelling.set(k, name);
    sec.set(k, (sec.get(k) ?? 0) + d);
  };
  view.talkTime.forEach((t) => add(t.speaker, t.sec));
  for (const r of rows) {
    const d = Math.max(0, r.end - r.start);
    if (!r.unresolved) {
      if (r.overridden && r.override && r.labelName) {
        add(r.labelName, -d);
        add(r.override, d);
      }
    } else if (!r.pending && r.name) {
      add(r.name, d);
    }
  }
  const list = [...sec.entries()]
    .map(([k, s]) => ({ name: spelling.get(k) ?? k, sec: Math.max(0, s) }))
    .filter((x) => x.sec > 0.05)
    .sort((a, b) => b.sec - a.sec);
  const total = list.reduce((a, x) => a + x.sec, 0);
  return list.map((x) => ({ ...x, share: total > 0 ? x.sec / total : 0 }));
}

/** 表示する人の並び（発言時間の多い順、発言時間の無い名前、最後に「名無し」があるか） */
export function peopleOf(rows: Row[], talk: TalkRow[]): { names: string[]; hasNoName: boolean } {
  const names = talk.map((t) => t.name);
  const keys = new Set(names.map(nameKey));
  for (const r of rows) {
    if (r.name && !keys.has(nameKey(r.name))) {
      keys.add(nameKey(r.name));
      names.push(r.name);
    }
  }
  return { names, hasNoName: rows.some((r) => r.name === null) };
}

/** 名前を選ぶ欄の並び: ラベルの名前（一覧の順・重ねない）、続けてこの画面で入力した名前 */
export function menuNames(labelOrder: string[], appliedNames: Names, lineNames: Record<string, string>) {
  const labelNames: string[] = [];
  const keys = new Set<string>();
  for (const label of labelOrder) {
    const n = appliedNames[label] || label;
    if (!keys.has(nameKey(n))) {
      keys.add(nameKey(n));
      labelNames.push(n);
    }
  }
  const freeNames: string[] = [];
  for (const raw of Object.values(lineNames)) {
    const n = cleanName(raw);
    if (n && !keys.has(nameKey(n))) {
      keys.add(nameKey(n));
      freeNames.push(n);
    }
  }
  return { labelNames, freeNames };
}

/** 名前の色: ラベルの色（まとめた人は最初のラベルの色）、この画面で入力した名前は灰色 */
export function colorForName(
  name: string,
  labelsInColorOrder: string[],
  appliedNames: Names,
  labelColor: Record<string, string>,
): string {
  const k = nameKey(name);
  for (const label of labelsInColorOrder) {
    if (nameKey(appliedNames[label] || label) === k) return labelColor[label];
  }
  return FREE_NAME_COLOR;
}

/** 検索に一致した行の id（いま出ている行の、直した後の文字。大文字と小文字は区別しない。1行は1件） */
export function searchMatches(rows: Row[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return rows.filter((r) => r.text.toLowerCase().includes(q)).map((r) => r.id);
}

/** 一致した文字を塗るための区切り */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  if (lower.length !== text.length) return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  let pos = 0;
  let at = lower.indexOf(ql);
  while (at >= 0) {
    if (at > pos) parts.push({ text: text.slice(pos, at), hit: false });
    parts.push({ text: text.slice(at, at + ql.length), hit: true });
    pos = at + ql.length;
    at = lower.indexOf(ql, pos);
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

/** 保存のときに渡す手直し（約束 版3 の LineEdits）。何も無ければ undefined */
export function buildEdits(rows: Row[]): LineEdits | undefined {
  const names: Record<string, string> = {};
  const confirmed: string[] = [];
  const texts: Record<string, string> = {};
  for (const r of rows) {
    if (r.override && (r.unresolved || r.overridden)) names[r.id] = r.override;
    if (r.unresolved && !r.pending) confirmed.push(r.id);
    if (r.history.length && r.text !== r.original) texts[r.id] = r.text;
  }
  const edits: LineEdits = {};
  if (Object.keys(names).length) edits.names = names;
  if (confirmed.length) edits.confirmed = confirmed;
  if (Object.keys(texts).length) edits.texts = texts;
  return Object.keys(edits).length ? edits : undefined;
}

export interface ResultStats {
  rows: number;
  chars: number;
  overlaps: number;
  editedRows: number;
  renamedRows: number;
  pending: number;
  confirmed: number;
}

export function resultStats(rows: Row[]): ResultStats {
  let chars = 0;
  let overlaps = 0;
  let editedRows = 0;
  let renamedRows = 0;
  let pending = 0;
  let confirmed = 0;
  for (const r of rows) {
    chars += countChars(r.text);
    if (r.overlap) overlaps++;
    if (r.history.length) editedRows++;
    if (!r.unresolved && r.overridden) renamedRows++;
    if (r.pending) pending++;
    else if (r.unresolved) confirmed++;
  }
  return { rows: rows.length, chars, overlaps, editedRows, renamedRows, pending, confirmed };
}

/** 直した文字: 改行は半角の空白に、前後の空白を除く（§8.5.3） */
export function normalizeEditedText(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}
