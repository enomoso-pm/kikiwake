// 確認用の欄（UI 画面仕様書 §8.7）。話者を決められなかった部分を、消さずに本文とは別枠で見せる
import { formatTimestamp } from "@contract/format";
import type { Row } from "../../lib/transcript";
import { confirmNamedUnresolved, jumpToLine } from "../../store/result";

export function UnresolvedPanel({ rows, durationSec }: { rows: Row[]; durationSec: number }) {
  const pending = rows.filter((r) => r.pending);
  const named = pending.filter((r) => r.name).length;
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 16px",
        borderRadius: 8,
        border: "1px solid var(--unres-line)",
        background: "var(--unres-bg)",
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 600 }}>確認用：話者を決められなかった部分（{pending.length}）</h2>
      <p style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>多くは無音の聞き違いです。押すと本文のその箇所へ移ります。</p>
      {pending.length ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className="nowrap" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              名前を入れた {named}件
            </span>
            <button
              type="button"
              disabled={named === 0}
              title="名前を入れた部分を確定して、この一覧から外します"
              onClick={confirmNamedUnresolved}
              style={{
                whiteSpace: "nowrap",
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                padding: "5px 12px",
                borderRadius: 5,
                border: `1px solid ${named ? "var(--accent)" : "var(--unres-line)"}`,
                background: named ? "var(--accent)" : "#fff",
                color: named ? "#fff" : "var(--placeholder)",
                cursor: named ? "pointer" : "default",
              }}
            >
              確定して一覧から外す
            </button>
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", margin: "0 -6px" }}>
            {pending.map((r) => (
              <button
                key={r.id}
                type="button"
                className="unres-item"
                title="本文のこの箇所へ移って名前を入れる"
                onClick={() => jumpToLine(r.id, true)}
              >
                <span className="mono" style={{ fontSize: 12, lineHeight: "22px", color: "var(--ink-4)" }}>
                  {formatTimestamp(r.start, durationSec)}
                </span>
                <span style={{ fontSize: 14, lineHeight: "22px", overflowWrap: "anywhere" }}>{r.text}</span>
                <span className="nowrap" style={{ fontSize: 12, color: r.name ? "var(--ok-ink)" : "var(--ink-4)" }}>
                  {r.name ? `→ ${r.name}` : "名無し"}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>残っていません。</span>
      )}
    </section>
  );
}
