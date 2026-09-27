// 下の帯（保存。UI 画面仕様書 §8.9）。保存ボタンは右下で、名前付けの主ボタンと同じ位置
// 保存するファイルの名前は Python 版と同じ（transcript_named.md など。約束 版3）。同じ名前があればいつも確かめる
import type { SaveFormat } from "@contract/types";
import { useT } from "../../i18n";
import { basename } from "../../lib/format";
import { changeOutDir, revealSaved, save, toggleFormat } from "../../store/result";
import { useApp, useIsMac } from "../../store/state";

const FORMATS: SaveFormat[] = ["md", "txt", "json"];

export function SaveBar() {
  const t = useT();
  const formats = useApp((s) => s.formats);
  const outDir = useApp((s) => s.outDir);
  const saving = useApp((s) => s.saving);
  const saved = useApp((s) => s.saved);
  const isMac = useIsMac();
  const anyFormat = FORMATS.some((f) => formats[f]);

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "14px 32px",
        borderTop: "1px solid var(--line)",
        background: "var(--bg-bar)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", minWidth: 0 }}>
        {FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            className={`check-chip${formats[f] ? " on" : ""}`}
            aria-pressed={formats[f]}
            onClick={() => toggleFormat(f)}
            style={{ padding: "6px 10px", color: "var(--ink)" }}
          >
            <span className="check-box">{formats[f] ? "✓" : ""}</span>.{f}
          </button>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 240px" }}>
          <span style={{ flex: "none", fontSize: 12, color: "var(--ink-3)" }}>{t.save.saveTo}</span>
          <span
            className="mono ellipsis"
            title={outDir}
            style={{ minWidth: 0, maxWidth: 360, fontSize: 12, padding: "6px 10px", borderRadius: 6, background: "var(--bg-muted)" }}
          >
            {outDir}
          </span>
          <button type="button" className="btn btn-small" onClick={() => void changeOutDir()}>
            {t.save.change}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
        {saved ? (
          <>
            <span className="nowrap" title={saved.files.map(basename).join("\n")} style={{ fontSize: 13, color: "var(--ok-ink)" }}>
              {t.save.saved(saved.files.length)}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => void revealSaved()}
              style={{ fontSize: 13, padding: "8px 12px", border: "1px solid #a9ccb6", background: "#fff", color: "var(--ok-ink)" }}
            >
              {t.common.reveal(isMac)}
            </button>
          </>
        ) : null}
        <button type="button" className="btn btn-primary" disabled={!anyFormat || saving} onClick={() => void save()}>
          {saving ? t.save.saving : t.save.save}
        </button>
      </div>
    </div>
  );
}
