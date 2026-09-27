// 新しい版の更新内容と入れ替えかたの窓（約束 版10。2026-09-27 決定: 自動では入れ替えない）。
// 手順は README の「入れ方」と同じ順（「このまま開く」は、一度開いて警告を出したあとにしか現れない）。「あとで」は閉じるだけ
import { useEffect, useId, useRef } from "react";
import { useT } from "../i18n";
import { formatMonthDay } from "../lib/format";
import { isEscape } from "../lib/keys";
import { closeUpdate, openReleasePage } from "../store/update";
import { useApp } from "../store/state";

export function UpdateDialog() {
  const t = useT();
  const u = t.update;
  const update = useApp((s) => s.update);
  const open = useApp((s) => s.updateOpen);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (isEscape(e)) {
        e.preventDefault();
        e.stopPropagation();
        closeUpdate();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open || !update) return null;
  const day = update.publishedAt ? formatMonthDay(update.publishedAt) : null;
  const notes = update.notes.trim();
  return (
    <div className="scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-update-dialog=""
        style={{ width: 540, maxHeight: "calc(100vh - 80px)", overflow: "hidden" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span id={titleId} className="dialog-title">
            {u.title(update.title)}
          </span>
          <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {t.objects.meta([day ? u.published(day) : "", u.current(update.current)].filter(Boolean))}
          </span>
        </div>
        {/* 題とボタンは動かさず、間（更新内容と手順）だけをスクロールする（狭い窓でも題とボタンが見えるように） */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{u.notesTitle}</span>
            <pre
              style={{
                margin: 0,
                maxHeight: 160,
                overflow: "auto",
                padding: "10px 12px",
                borderRadius: 6,
                background: "var(--bg-muted)",
                font: "inherit",
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                color: "var(--ink-2)",
              }}
            >
              {notes || u.notesEmpty}
            </pre>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{u.stepsTitle}</span>
            <ol className="pretty" style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: "var(--ink-2)" }}>
              {u.steps(update.version).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="pretty" style={{ fontSize: 12, lineHeight: 1.6, color: "var(--ink-3)" }}>
              {u.macos14}
            </p>
            <p className="pretty" style={{ fontSize: 12, lineHeight: 1.6, color: "var(--ink-3)" }}>
              {u.note}
            </p>
          </div>
        </div>
        <div className="dialog-buttons" style={{ flex: "none" }}>
          <button type="button" className="btn btn-secondary" onClick={closeUpdate}>
            {u.later}
          </button>
          <button ref={primaryRef} type="button" className="btn btn-primary" onClick={() => void openReleasePage()}>
            {u.open}
          </button>
        </div>
      </div>
    </div>
  );
}
