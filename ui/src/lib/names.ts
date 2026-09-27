// 名前付けの名前のまとめ方（UI 画面仕様書 §7.3・§13 Q4）。
// 前後の空白を除き、全角と半角の違いは同じとみなす（2026-09-26 決定）。
// まとまった名前の書き方は、一覧で上にあるラベルの書き方にそろえる。
import type { Names } from "@contract/types";
import { getT } from "../i18n";

/** 前後の空白（全角も含む）を除いた名前 */
export function cleanName(s: string | undefined): string {
  return (s ?? "").trim();
}

/** 同じ人かどうかを比べるための鍵。全角・半角の違いをそろえる（NFKC） */
export function nameKey(s: string | undefined): string {
  return cleanName(s).normalize("NFKC").trim();
}

export interface NameGroup {
  key: string;
  /** まとまった名前（グループの中で一覧の一番上のラベルに付けた書き方） */
  name: string;
  /** 一覧の順 */
  labels: string[];
}

export interface NameGrouping {
  groups: NameGroup[];
  byLabel: Record<string, NameGroup | undefined>;
  /** 名前の無いラベル（一覧の順） */
  unnamed: string[];
}

/** ラベル（一覧の順）と入力された名前から、同じ名前のまとまりを作る */
export function groupNames(order: string[], names: Record<string, string>): NameGrouping {
  const groups: NameGroup[] = [];
  const byKey = new Map<string, NameGroup>();
  const byLabel: Record<string, NameGroup | undefined> = {};
  const unnamed: string[] = [];
  for (const label of order) {
    const key = nameKey(names[label]);
    if (!key) {
      unnamed.push(label);
      continue;
    }
    let g = byKey.get(key);
    if (!g) {
      g = { key, name: cleanName(names[label]), labels: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.labels.push(label);
    byLabel[label] = g;
  }
  return { groups, byLabel, unnamed };
}

/** api.applyNames に渡す名前。空のラベルは渡さず、まとまった名前は同じ書き方にそろえる */
export function namesForApply(order: string[], names: Record<string, string>): Names {
  const { byLabel } = groupNames(order, names);
  const out: Names = {};
  for (const label of order) {
    const g = byLabel[label];
    if (g) out[label] = g.name;
  }
  return out;
}

/** 保存される人数: 名前の種類の数＋名前の無いラベルの数 */
export function peopleCount(grouping: NameGrouping): number {
  return grouping.groups.length + grouping.unnamed.length;
}

/** 名前付けの下の帯の1行目（§7.4） */
export function namingSummary(order: string[], grouping: NameGrouping): string {
  const t = getT();
  const merged = grouping.groups
    .filter((g) => g.labels.length > 1)
    .map((g) => t.naming.mergedItem(g.labels.map(t.engine.speakerLabel), g.name));
  return t.naming.saveAs(t.naming.labelCount(order.length), peopleCount(grouping)) + (merged.length ? t.naming.mergedList(merged) : "");
}

/** 名前付けの下の帯の2行目（§7.4） */
export function namingSummarySub(grouping: NameGrouping): string {
  const t = getT();
  return grouping.unnamed.length
    ? t.naming.unnamed(t.common.labels(grouping.unnamed.map(t.engine.speakerLabel)))
    : t.naming.allNamed;
}

// 手がかりの種類はエンジンが日本語で返す（Python 版と同じ JSON の鍵）。表示は今の言語で
const HINT_ORDER = ["自己紹介", "呼びかけ直後"] as const;

/** 手がかりの出どころ: 「自己紹介2・呼びかけ直後1」 */
export function formatHintSources(sources: Partial<Record<(typeof HINT_ORDER)[number], number>>): string {
  const t = getT();
  return HINT_ORDER.filter((k) => (sources[k] ?? 0) > 0)
    .map((k) => t.naming.source(t.engine.hintKind(k), sources[k] ?? 0))
    .join(t.naming.sourceSep);
}

/** 名前の手がかり: 「田中（自己紹介2・呼びかけ直後1）」。複数の名前は「・」でつなぐ。無ければ null */
export function formatHints(hints: Array<{ name: string; sources: Parameters<typeof formatHintSources>[0] }>): string | null {
  if (!hints.length) return null;
  const t = getT();
  return hints.map((h) => t.naming.hint(h.name, formatHintSources(h.sources))).join(t.common.listSep);
}
