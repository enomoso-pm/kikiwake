// 保存の形式と保存先を覚えておく（2026-09-29 決定: 「保存…」の窓で一度選んだら、ほかの録音でも次から同じ）。
// 保存先 dir が null なら「元のファイルと同じフォルダ」（録音ごとに変わる。エンジンが返す既定 JobView.outDir）。
// recent は前に選んだフォルダ（「元のファイルと同じフォルダ」に戻したあとも、窓の選択肢に残す）。localStorage の kikiwake.save
import type { SaveFormat } from "@contract/types";

export interface SavePrefs {
  formats: SaveFormat[];
  dir: string | null;
  recent: string | null;
}

const KEY = "kikiwake.save";
export const SAVE_FORMATS: readonly SaveFormat[] = ["md", "txt", "json"];

/** 初めは .md だけ・元のファイルと同じフォルダ（今までの既定と同じ） */
export function defaultSavePrefs(): SavePrefs {
  return { formats: ["md"], dir: null, recent: null };
}

/** 覚えている値から作る（壊れた値・知らない形式は捨てる。形式が1つも残らなければ .md） */
export function parseSavePrefs(raw: unknown): SavePrefs {
  if (!raw || typeof raw !== "object") return defaultSavePrefs();
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.formats) ? o.formats : [];
  const formats = SAVE_FORMATS.filter((f) => list.includes(f));
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const dir = text(o.dir);
  return { formats: formats.length ? formats : ["md"], dir, recent: text(o.recent) ?? dir };
}

export function loadSavePrefs(): SavePrefs {
  try {
    return parseSavePrefs(JSON.parse(window.localStorage.getItem(KEY) ?? "null"));
  } catch {
    return defaultSavePrefs();
  }
}

export function storeSavePrefs(p: SavePrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 覚えておけない所では、この回だけ
  }
}
