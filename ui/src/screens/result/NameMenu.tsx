// 名前を選ぶ欄（UI 画面仕様書 §8.6）。窓の上に浮かべて出す。外を押す・Esc・名前を決める・戻すで閉じる
import { useEffect } from "react";
import { formatTimestamp } from "@contract/format";
import { useT } from "../../i18n";
import { FREE_NAME_DOT } from "../../lib/colors";
import { isCommitKey, isEscape } from "../../lib/keys";
import { nameKey } from "../../lib/names";
import { menuNames, type Row } from "../../lib/transcript";
import { chooseLineName, closeNameMenu, resetLineName, setMenuValue } from "../../store/result";
import { useApp, useIsMac } from "../../store/state";

const WIDTH = 250;

export function NameMenu({
  rows,
  colorOf,
  durationSec,
}: {
  rows: Row[];
  colorOf: (name: string | null) => string;
  durationSec: number;
}) {
  const t = useT();
  const menu = useApp((s) => s.nameMenu);
  const speakers = useApp((s) => s.speakers);
  const appliedNames = useApp((s) => s.appliedNames);
  const lineNames = useApp((s) => s.lineNames);
  const mod = useIsMac() ? "⌘" : "Ctrl";

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEscape(e)) {
        e.preventDefault();
        closeNameMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  if (!menu) return null;
  const row = rows.find((r) => r.id === menu.id);
  if (!row) return null;

  const { labelNames, freeNames } = menuNames(
    speakers.map((c) => c.label),
    appliedNames,
    lineNames,
  );
  const currentKey = row.name ? nameKey(row.name) : null;
  const labelKey = row.labelName ? nameKey(row.labelName) : null;
  const options = [
    ...labelNames.map((name) => ({ name, dot: colorOf(name), note: !row.unresolved && nameKey(name) === labelKey ? t.nameMenu.labelName : "" })),
    ...freeNames.map((name) => ({ name, dot: FREE_NAME_DOT, note: t.nameMenu.typedHere })),
  ];

  // 置き場所: 名前の左端から 8 左。下に 280 以上の余裕があるか、上より下が広ければ下に
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const a = menu.anchor;
  const below = vh - a.bottom - 12;
  const above = a.top - 12;
  const up = below < 280 && above > below;
  const left = Math.max(8, Math.min(a.left - 8, vw - WIDTH - 12));

  return (
    <>
      <div onClick={closeNameMenu} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
      <div
        role="dialog"
        aria-label={t.nameMenu.aria}
        style={{
          position: "fixed",
          left,
          top: up ? "auto" : a.bottom + 4,
          bottom: up ? vh - a.top + 4 : "auto",
          maxHeight: Math.max(180, up ? above : below),
          zIndex: 31,
          width: WIDTH,
          boxSizing: "border-box",
          background: "#fff",
          border: "1px solid #d6d6d1",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.14)",
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t.nameMenu.heading(formatTimestamp(row.start, durationSec))}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minHeight: 0, flex: "1 1 auto", overflow: "auto" }}>
          {options.map((o) => {
            const selected = currentKey !== null && nameKey(o.name) === currentKey;
            return (
              <button
                key={`${o.note}:${o.name}`}
                type="button"
                className={`name-option${selected ? " selected" : ""}`}
                onClick={() => chooseLineName(row.id, o.name)}
              >
                <span className="dot" style={{ width: 8, height: 8, background: o.dot }} />
                <span className="nowrap">{t.engine.speakerLabel(o.name)}</span>
                <span className="nowrap" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-4)" }}>
                  {selected ? t.nameMenu.selected : o.note}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          <input
            autoFocus
            className="input"
            value={menu.value}
            placeholder={t.nameMenu.otherPlaceholder}
            onChange={(e) => setMenuValue(e.target.value)}
            onKeyDown={(e) => {
              if (isCommitKey(e)) {
                e.preventDefault();
                chooseLineName(row.id, menu.value);
              } else if (isEscape(e)) {
                e.preventDefault();
                closeNameMenu();
              }
            }}
            style={{ width: "100%", boxSizing: "border-box", fontSize: 14, padding: "6px 8px", borderRadius: 5 }}
          />
          <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{t.nameMenu.keys(mod)}</span>
        </div>
        {row.override ? (
          <button
            type="button"
            onClick={() => resetLineName(row.id)}
            style={{
              alignSelf: "flex-start",
              font: "inherit",
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 5,
              border: "1px solid var(--line-input)",
              background: "#fff",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            {row.unresolved ? t.nameMenu.backToNoName : t.nameMenu.backToLabel(t.engine.speakerLabel(row.labelName ?? ""))}
          </button>
        ) : null}
      </div>
    </>
  );
}
