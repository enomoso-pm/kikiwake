// 話者の色（UI 画面仕様書 §3.1）。oklch(0.52 0.1 H)、H = (250 + i × 360 ÷ ラベルの数) mod 360

export const FREE_NAME_COLOR = "#3d4046"; // 結果の画面で自由に入力した名前
export const FREE_NAME_DOT = "#9a9ea4"; // 名前を選ぶ欄の丸
export const NO_NAME_COLOR = "#8a8e95"; // 「名無し」の文字
export const NO_NAME_DOT = "#b0b3b8"; // 表示する人の「名無し」の丸

export function hueColor(i: number, n: number): string {
  const h = Math.round((250 + (i * 360) / Math.max(1, n)) % 360);
  return `oklch(0.52 0.1 ${h})`;
}

/** ラベルの順番（話者A が 0）で色を決める */
export function labelColors(labels: string[]): Record<string, string> {
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
  const out: Record<string, string> = {};
  sorted.forEach((label, i) => {
    out[label] = hueColor(i, sorted.length);
  });
  return out;
}
