// 録音が主役の画面: 一覧で選んでいる行。右に出しているもの（画面の状態）と、一覧だけで選んだもの（途中・順番待ち）から決める
import { useMemo } from "react";
import { hasUnsavedEdits } from "../store/result";
import { useApp } from "../store/state";
import { buildEntries, namedSpeakersOf, samePath, type Entry, type Live } from "./model";
import { isRunning, useObjects } from "./store";

/** "new"（新しい録音）・"settings"・"run"（処理中）・"q:〈順番待ちの id〉"・"h:〈jobId〉"（履歴） */
export function useSelectedKey(): string {
  const peek = useObjects((s) => s.peek);
  const opening = useObjects((s) => s.opening);
  const openError = useObjects((s) => s.openError);
  const running = useObjects((s) => s.running);
  const screen = useApp((s) => s.screen);
  const job = useApp((s) => s.job);
  if (peek) return peek.kind === "queued" ? `q:${peek.id}` : `h:${peek.jobId}`;
  if (opening) return `h:${opening}`;
  if (openError) return `h:${openError.jobId}`;
  if (screen === "setup") return "settings";
  if (screen === "file" || !job) return "new";
  if (running && isRunning(job) && (job.jobId && running.jobId ? job.jobId === running.jobId : samePath(job.path, running.path))) return "run";
  return job.jobId ? `h:${job.jobId}` : "new";
}

/** 一覧に並べるもの（左の一覧と、右の録音の上の段で同じものを使う） */
export function useEntries(): Entry[] {
  const running = useObjects((s) => s.running);
  const runningMeta = useObjects((s) => s.runningMeta);
  const queue = useObjects((s) => s.queue);
  const order = useObjects((s) => s.order);
  const history = useApp((s) => s.history);
  return useMemo(
    () => buildEntries(running, runningMeta?.name ?? "", runningMeta?.durationSec ?? 0, queue, history, order),
    [running, runningMeta, queue, history, order],
  );
}

/** 右に出している録音の行（無ければ null。新しい録音・設定の画面、または一覧を読み直している間） */
export function useCurrentEntry(): Entry | null {
  const entries = useEntries();
  const key = useSelectedKey();
  return entries.find((e) => e.key === key) ?? null;
}

/** 開いている録音の今の様子（一覧の値より新しい）と、再生できるか。開いていない行は null */
export function useLive(e: Entry | null): { live: Live | null; playable: boolean | null } {
  const openJobId = useApp((s) => (s.job?.status === "done" ? s.job.jobId : null));
  const peek = useObjects((s) => s.peek);
  const named = useApp((s) => (s.view ? Object.values(s.appliedNames).some((v) => v.trim()) : null));
  const unsaved = useApp((s) => (s.view ? hasUnsavedEdits(s) : null));
  const savedFiles = useApp((s) => Boolean(s.saved?.files.length));
  const savedOnce = useApp((s) => s.savedOnce);
  const talkTime = useApp((s) => s.view?.talkTime ?? null);
  const applied = useApp((s) => s.appliedNames);
  const people = useMemo(() => (talkTime ? namedSpeakersOf(talkTime, applied) : undefined), [talkTime, applied]);
  const playable = useApp((s) => s.playable);
  const open = Boolean(openJobId && e && e.kind === "history" && e.item.jobId === openJobId && peek === null);
  if (!open || !openJobId) return { live: null, playable: null };
  return {
    live: {
      named,
      savedOnce: savedFiles || savedOnce,
      // 保存しました（今の中身のファイルがある）ときだけ、保存後の手直しを数える
      savedNow: savedFiles ? (unsaved === null ? null : !unsaved) : false,
      people,
    },
    playable,
  };
}
