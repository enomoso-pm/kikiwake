// 棒グラフ（UI 画面仕様書 §2.4）。角丸は高さの半分。
// 見本どおり、準備と処理中の棒は中身の端も丸め、名前付け・再生の進み具合・詳細の棒は丸めない（roundFill={false}）
import type { CSSProperties } from "react";

export function Bar({
  ratio,
  height,
  color,
  roundFill = true,
  style,
}: {
  ratio: number;
  height: number;
  color: string;
  roundFill?: boolean;
  style?: CSSProperties;
}) {
  const w = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="track" style={{ height, borderRadius: height / 2, ...style }}>
      <div className="fill" style={{ width: `${w}%`, background: color, borderRadius: roundFill ? height / 2 : 0 }} />
    </div>
  );
}

/** 長さの分からない進み具合（音声の取り出し・話者の判定・突き合わせ） */
export function IndeterminateBar({ height }: { height: number }) {
  return (
    <div className="track indet" style={{ height, borderRadius: height / 2 }}>
      <div className="fill" />
    </div>
  );
}
