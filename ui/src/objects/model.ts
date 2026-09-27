// 録音が主役の画面（案A）の一覧の中身を決める計算（画面の部品を持たない。テストは model.test.ts）。
// 一覧に並ぶのは「処理中の録音」「順番待ちの録音」「履歴の録音」。どれも同じ録音というものの状態の違いとして扱う
import type { HistoryItem, Names, NamedSpeakers, SourceState, TalkTime } from "@contract/types";
import type { JobView } from "../store/state";

export interface QueueItem {
  id: string;
  path: string;
  name: string;
  durationSec: number;
}

export type Entry =
  | { kind: "running"; key: string; name: string; path: string; durationSec: number; job: JobView }
  | { kind: "queued"; key: string; item: QueueItem; position: number }
  | { kind: "history"; key: string; item: HistoryItem };

/**
 * 状態の印（一覧と録音の上に1つ出す。2026-09-27 決定: 保存を軸にした6つ）。
 * 順番待ち → 文字起こし中 → 保存前 → 保存済み（保存後に直したら「保存後に手直し」）、止まったら「中断」。
 * 名前が付いているかは印にしない（名前を付けなくても保存できるため。録音の情報として出す）
 */
export type Status =
  | { id: "queued"; position: number }
  | { id: "running"; percent: number | null }
  | { id: "stopped" }
  | { id: "notSaved" }
  | { id: "saved" }
  | { id: "editedAfterSave" };

export type Tone = "accent" | "muted" | "warn" | "ok";

export function toneOf(s: Status): Tone {
  switch (s.id) {
    case "running":
      return "accent";
    case "stopped":
    case "editedAfterSave":
      return "warn";
    case "saved":
      return "ok";
    default:
      return "muted";
  }
}

/** 場所の比べ方（Mac の / と Windows の \、末尾の区切りの違いは同じとみなす） */
export function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return n(a) === n(b);
}

/**
 * 一覧の並び: 前に並べた順を保ち、新しく出てきた録音だけ一番上に足す。
 * エンジンは「最後に使った順」で返すので、そのまま並べると手直しするたびに行が上へ動いてしまう
 */
export function mergeOrder(order: readonly string[], history: readonly HistoryItem[]): string[] {
  const ids = history.map((h) => h.jobId);
  const known = new Set(order);
  const alive = new Set(ids);
  return [...ids.filter((id) => !known.has(id)), ...order.filter((id) => alive.has(id))];
}

/**
 * 一覧に並べるもの。処理中 → 順番待ち → 履歴（並べた順）。
 * 続きから処理している・順番待ちにした途中の録音は、履歴の行を出さない（同じ録音を2行にしない）
 */
export function buildEntries(
  running: JobView | null,
  runningName: string,
  runningDuration: number,
  queue: readonly QueueItem[],
  history: readonly HistoryItem[] | null,
  order: readonly string[],
): Entry[] {
  const out: Entry[] = [];
  const busy: string[] = [];
  if (running && running.status === "running") {
    out.push({ kind: "running", key: "run", name: runningName, path: running.path, durationSec: runningDuration, job: running });
    busy.push(running.path);
  }
  queue.forEach((q, i) => {
    out.push({ kind: "queued", key: `q:${q.id}`, item: q, position: i + 1 });
    busy.push(q.path);
  });
  const pos = new Map(order.map((id, i) => [id, i]));
  const sorted = [...(history ?? [])].sort((a, b) => (pos.get(a.jobId) ?? -1) - (pos.get(b.jobId) ?? -1));
  for (const item of sorted) {
    if (running && running.status === "running" && item.jobId === running.jobId) continue;
    if (item.status === "unfinished" && busy.some((p) => samePath(p, item.path))) continue;
    out.push({ kind: "history", key: `h:${item.jobId}`, item });
  }
  return out;
}

/** 開いている録音の今の様子（一覧の値より新しい。保存したか・手直しがあるかは画面が持っている） */
export interface Live {
  /** 確定した名前があるか。まだ一度も確定し直していない（名前付けの画面から入った）ときは null で、一覧の値を使う */
  named: boolean | null;
  /** ファイルに保存したことがあるか（保存したあとで名前を変えても残る。閉じたときの状態の savedOnce） */
  savedOnce: boolean;
  /** 今の中身を保存し終えているか。数えられない（結果を読み込む前）ときは null で、一覧の値を使う */
  savedNow: boolean | null;
  /** 付けた名前（名前が無ければ null）。数えられない（結果を読み込む前）ときは undefined で、一覧の値を使う */
  people?: NamedSpeakers | null;
}

/** 状態の印。開いている録音は live（画面の今の値）で決める */
export function statusOf(e: Entry, live: Live | null): Status {
  if (e.kind === "running") {
    return { id: "running", percent: e.job.stage === "transcribe" ? Math.floor(e.job.percent) : null };
  }
  if (e.kind === "queued") return { id: "queued", position: e.position };
  const item = e.item;
  if (item.status === "unfinished") return { id: "stopped" };
  const savedOnce = Boolean(live?.savedOnce) || item.saved;
  if (!savedOnce) return { id: "notSaved" };
  const clean = live && live.savedNow !== null ? live.savedNow : item.saved && !item.unsavedEdits;
  return { id: clean ? "saved" : "editedAfterSave" };
}

/**
 * 付けた名前（約束 版9 の namedSpeakers と同じ形）を、結果の画面の発言時間（名前でまとめ、多い順）と確定した名前から作る。
 * 開いている録音は一覧を読み直す前でも今の名前を出すため。名前が1つも無ければ null
 */
export function namedSpeakersOf(talkTime: TalkTime[], applied: Names): NamedSpeakers | null {
  const named = new Set(Object.values(applied).map((v) => v.trim()).filter(Boolean));
  const names: string[] = [];
  let unnamed = 0;
  for (const t of talkTime) {
    if (named.has(t.speaker)) names.push(t.speaker);
    else unnamed += 1;
  }
  return names.length ? { names, unnamed } : null;
}

/** 付けた名前（開いている録音は画面の今の値）。名前が無ければ null */
export function peopleOf(e: Entry, live: Live | null): NamedSpeakers | null {
  if (e.kind !== "history") return null;
  if (live && live.people !== undefined) return live.people;
  return e.item.namedSpeakers ?? null;
}

/** 一覧の行に出す名前（2026-09-27 決定: 発言の多い順に2人と、残りの人数。名前を付けていない話者も数える） */
export function shownPeople(p: NamedSpeakers): { shown: string[]; rest: number } {
  const shown = p.names.slice(0, 2);
  return { shown, rest: p.names.length - shown.length + p.unnamed };
}

/** 名前が付いているか（開いている録音は画面の今の値） */
export function namedOf(e: Entry, live: Live | null): boolean {
  if (e.kind !== "history") return false;
  return live && live.named !== null ? live.named : e.item.named;
}

/** 元のファイルの状態（開いている録音は、画面が知っている「再生できるか」を先に見る） */
export function sourceOf(e: Entry, playable: boolean | null): SourceState {
  if (e.kind !== "history") return "ok";
  if (playable) return "ok";
  return e.item.sourceState;
}

/** 外付けのドライブ（Mac の /Volumes/〈名前〉/）にある場所なら、その名前 */
export function volumeOf(path: string): string | null {
  const m = /^\/Volumes\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}
