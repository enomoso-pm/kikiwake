// 数と時間の書き方（UI 画面仕様書 ver1.1 §2.8）。
// 録音の中の時刻（行・サンプルの時刻）は contract/format.ts の formatTimestamp を使う。ここはそれ以外

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 経過時間・録音の長さ: 1時間未満は m:ss、1時間以上は h:mm:ss（秒は切り捨て） */
export function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** 分の数を「N分」「H時間M分」に（0分は書かない） */
function minutesText(min: number): string {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

/** 残り時間: 分に切り上げ。1分未満でも「約1分」 */
export function formatRemaining(sec: number): string {
  const min = Math.max(1, Math.ceil(sec / 60));
  return `残り 約${minutesText(min)}`;
}

/** 所要時間の目安: 「約 28〜36 分」「約 1時間40分〜2時間10分」 */
export function formatEstimate(minSec: number, maxSec: number): string {
  const a = Math.max(1, Math.round(minSec / 60));
  const b = Math.max(a, Math.round(maxSec / 60));
  if (b < 60) return a === b ? `約 ${a} 分` : `約 ${a}〜${b} 分`;
  if (a === b) return `約 ${minutesText(a)}`;
  return `約 ${minutesText(a)}〜${minutesText(b)}`;
}

const GB = 1e9;
const MB = 1e6;

/** AI モデルの大きさ（項目名の横）: 1 GB 未満は MB の整数、以上は GB の小数1桁 */
export function formatModelSize(bytes: number): string {
  return bytes < GB ? `${Math.round(bytes / MB)} MB` : `${(bytes / GB).toFixed(1)} GB`;
}

/** 取れた量と全体: 全体が 1 GB 未満なら MB の整数、以上なら GB の小数2桁 */
export function formatProgressBytes(got: number, total: number): string {
  if (total < GB) return `${Math.round(got / MB)} / ${Math.round(total / MB)} MB`;
  return `${(got / GB).toFixed(2)} / ${(total / GB).toFixed(2)} GB`;
}

/** 録音のファイルの大きさ: 「5.2 MB」「62.4 MB」「228 MB」「1.4 GB」 */
export function formatFileSize(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  const mb = bytes / MB;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** 3桁ごとのカンマ */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** 「2026-09-24」→「9月24日」。読めなければ null */
export function formatMonthDay(ymd: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!month || !day) return null;
  return `${month}月${day}日`;
}

/** 拡張子（小文字）。無ければ空 */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** ファイルの形式の表示。m4a は「m4a（ボイスメモ）」 */
export function fileFormatLabel(name: string): string {
  const ext = extensionOf(name);
  return ext === "m4a" ? "m4a（ボイスメモ）" : ext;
}

/** パスの最後の部分（Mac の / と Windows の \ の両方） */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** 字数（サロゲートペアを1字と数える） */
export function countChars(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** 冒頭 max 字。超えたら max 字で切って「…」 */
export function truncate(text: string, max = 70): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") + "…" : text;
}

/** 割合（0〜1）を整数の ％ に */
export function percentText(share: number): string {
  return `${Math.round(share * 100)}%`;
}
