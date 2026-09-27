// 詳細モーダル（UI 画面仕様書 §8.8）。話者ごとの発言時間を一番上に。録音の情報と処理の条件は出さない（D12）
import { useEffect, useRef } from "react";
import { Bar } from "../../components/Bar";
import { useT } from "../../i18n";
import { formatCount } from "../../lib/format";
import { isEscape } from "../../lib/keys";
import type { ResultStats, TalkRow } from "../../lib/transcript";
import { goToNamingFor } from "../../store/naming";
import { closeDetail } from "../../store/result";
import { useApp } from "../../store/state";

function Section({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map(([k, v]) => (
          <div
            key={k}
            style={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", gap: 12, padding: "6px 0", borderTop: "1px solid var(--line-soft)", fontSize: 13 }}
          >
            <span style={{ color: "var(--ink-3)" }}>{k}</span>
            <span className="num" style={{ overflowWrap: "anywhere" }}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DetailModal({
  talk,
  stats,
  labelCount,
  colorOf,
}: {
  talk: TalkRow[];
  stats: ResultStats;
  labelCount: number;
  colorOf: (name: string | null) => string;
}) {
  const t = useT();
  const open = useApp((s) => s.detailOpen);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (isEscape(e)) {
        e.preventDefault();
        closeDetail();
      } else if (e.key === "Tab" && boxRef.current) {
        // 開いている間、後ろの画面は操作できない（フォーカスをモーダルの中で回す）
        const items = [...boxRef.current.querySelectorAll<HTMLElement>("button, [tabindex='0']")];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
        e.preventDefault();
        items[next].focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;
  const toNaming = (name: string | null) => {
    closeDetail();
    goToNamingFor(name);
  };

  return (
    <div
      onClick={closeDetail}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.detail.title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "100%",
          maxHeight: "100%",
          overflow: "auto",
          boxSizing: "border-box",
          background: "#fff",
          borderRadius: 10,
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          boxShadow: "0 20px 60px rgba(0,0,0,.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t.detail.title}</span>
          <button ref={closeRef} type="button" className="icon-btn" title={t.common.close} onClick={closeDetail}>
            ✕
          </button>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>{t.detail.talkTitle}</h2>
            <button type="button" className="btn-link nowrap" style={{ font: "inherit", fontSize: 12, cursor: "pointer" }} onClick={() => toNaming(null)}>
              {t.detail.fixNames}
            </button>
          </div>
          {talk.map((row) => (
            <div
              key={row.name}
              className="talk-row"
              role="button"
              tabIndex={0}
              title={t.detail.fixNameOf(t.engine.speakerLabel(row.name))}
              onClick={() => toNaming(row.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toNaming(row.name);
                }
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{t.engine.speakerLabel(row.name)}</span>
                <span className="num" style={{ color: "var(--ink-3)" }}>
                  {t.detail.share(Math.round(row.share * 100), Math.round(row.sec / 60))}
                </span>
              </div>
              <Bar ratio={row.share} height={6} color={colorOf(row.name)} roundFill={false} />
            </div>
          ))}
        </section>

        <Section
          title={t.detail.textTitle}
          rows={[
            [t.detail.rowsChars, t.detail.rowsCharsValue(formatCount(stats.rows), formatCount(stats.chars))],
            [t.detail.speakers, t.detail.speakersValue(talk.length, labelCount)],
            [t.detail.overlaps, t.detail.overlapsValue(formatCount(stats.overlaps))],
          ]}
        />
        <Section
          title={t.detail.editsTitle}
          rows={[
            [t.detail.editedRows, t.detail.rowsValue(formatCount(stats.editedRows))],
            [t.detail.renamedRows, t.detail.rowsValue(formatCount(stats.renamedRows))],
            [t.detail.pending, t.detail.pendingValue(formatCount(stats.pending), formatCount(stats.confirmed))],
          ]}
        />
      </div>
    </div>
  );
}
