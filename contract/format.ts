// 表示の書式（Python 版の merge.py と同じ規則）。保存するファイル（transcript.md）とも一致させる。

/** 時刻の表示。録音が1時間以上なら h:mm:ss、未満なら mm:ss（秒は切り捨て） */
export function formatTimestamp(sec: number, durationSec: number): string {
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return durationSec >= 3600 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 本文1行の表示: 「[mm:ss] 話者A*: 本文」（* は声の重なり） */
export function formatLine(
  u: { start: number; speaker: string; text: string; overlap: boolean },
  durationSec: number,
): string {
  return `[${formatTimestamp(u.start, durationSec)}] ${u.speaker}${u.overlap ? "*" : ""}: ${u.text}`;
}
