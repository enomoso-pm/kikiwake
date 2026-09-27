// 再生ボタンと進み具合（名前付けのサンプル・確認用の手がかり）。同時に鳴るのは1つだけ（lib/player.ts）
import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { togglePlayback, usePlayer } from "../lib/player";
import { Bar } from "./Bar";

export function usePlaying(key: string): boolean {
  return usePlayer((p) => p.key === key);
}

/** 「▶ 再生」「■ 停止」（UI 画面仕様書 §7.3） */
export function SamplePlayButton({ playKey, src }: { playKey: string; src: () => string | Promise<string> }) {
  const t = useT();
  const playing = usePlaying(playKey);
  return (
    <button
      type="button"
      onClick={() => togglePlayback(playKey, src)}
      style={{
        font: "inherit",
        fontSize: 12,
        padding: "5px 0",
        borderRadius: 5,
        border: `1px solid ${playing ? "var(--accent)" : "var(--line-input)"}`,
        background: playing ? "var(--accent)" : "#fff",
        color: playing ? "#fff" : "var(--ink)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {playing ? t.common.stop : t.common.play}
    </button>
  );
}

/** 鳴っている間だけ出す進み具合（高さ 3） */
export function PlayProgress({ playKey, style }: { playKey: string; style?: CSSProperties }) {
  const progress = usePlayer((p) => (p.key === playKey ? p.progress : -1));
  if (progress < 0) return null;
  return <Bar ratio={progress} height={3} color="var(--accent)" roundFill={false} style={{ borderRadius: 2, ...style }} />;
}
