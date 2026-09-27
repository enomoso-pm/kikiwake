// 「文字起こし」のタブ: 結果（UI 画面仕様書 §8）
import { useMemo } from "react";
import { useT } from "../i18n";
import { NO_NAME_DOT } from "../lib/colors";
import { formatCount } from "../lib/format";
import { isPlainEnter } from "../lib/keys";
import { searchMatches } from "../lib/transcript";
import {
  jumpToTime,
  moveMatch,
  peopleKey,
  requestRevertAll,
  setSearch,
  showAllPeople,
  toggleHidden,
} from "../store/result";
import { useApp } from "../store/state";
import { NameMenu } from "./result/NameMenu";
import { TranscriptList } from "./result/TranscriptList";
import { UnresolvedPanel } from "./result/UnresolvedPanel";
import { useTranscriptModel } from "./result/useTranscriptModel";

/**
 * 録音が主役の画面の「文字起こし」のタブの中。録音の名前・「詳細」・元のファイルの帯は録音の上の段に、保存の帯は下に出す
 * （objects/RecordingHeader・MainPane。2026-09-27 決定）
 */
export function ResultScreen() {
  const t = useT();
  const { view, rows, people, stats, colorOf } = useTranscriptModel();
  const hidden = useApp((s) => s.hidden);
  const search = useApp((s) => s.search);
  const matchIndex = useApp((s) => s.matchIndex);
  const jobId = useApp((s) => s.job?.jobId ?? null);
  const playable = useApp((s) => s.playable);

  const visible = useMemo(() => rows.filter((r) => !hidden[peopleKey(r.name)]), [rows, hidden]);
  const matches = useMemo(() => searchMatches(visible, search), [visible, search]);
  const current = matches.length ? ((matchIndex % matches.length) + matches.length) % matches.length : 0;
  const currentMatchId = matches.length ? matches[current] : null;

  if (!view) return null;
  const durationSec = view.durationSec;
  const chips = [...people.names.map((n) => ({ name: n as string | null })), ...(people.hasNoName ? [{ name: null }] : [])];
  const shownPeople = chips.filter((c) => !hidden[peopleKey(c.name)]).length;
  const repeats = view.repeats ?? [];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 真ん中 */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)" }}>
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--line)", background: "#fff" }}>
          {/* 道具の1段目 */}
          <div
            style={{
              flex: "none",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px 10px",
              padding: "12px 28px",
              borderBottom: "1px solid var(--line-soft)",
            }}
          >
            <input
              className="input"
              value={search}
              placeholder={t.result.searchPlaceholder}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (isPlainEnter(e)) {
                  e.preventDefault();
                  moveMatch(e.shiftKey ? -1 : 1);
                }
              }}
              style={{ width: 220, flex: "none", fontSize: 14, padding: "7px 12px" }}
            />
            <span className="nowrap num" style={{ fontSize: 13, color: "var(--ink-3)", minWidth: 72 }}>
              {search.trim() ? (matches.length ? t.result.matches(current + 1, matches.length) : t.result.noMatches) : ""}
            </span>
            <button type="button" className="btn btn-small" onClick={() => moveMatch(-1)}>
              {t.result.prev}
            </button>
            <button type="button" className="btn btn-small" onClick={() => moveMatch(1)}>
              {t.result.next}
            </button>
            <span className="nowrap" style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-4)" }}>
              {t.result.hint}
            </span>
            {stats.editedRows ? (
              <>
                <span className="nowrap" style={{ fontSize: 12, color: "var(--accent-soft-ink)" }}>
                  {t.result.editedRows(stats.editedRows)}
                </span>
                <button type="button" className="btn btn-small" onClick={requestRevertAll}>
                  {t.result.revertAll}
                </button>
              </>
            ) : null}
          </div>

          {/* 道具の2段目「表示する人」 */}
          <div
            style={{
              flex: "none",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 6,
              padding: "10px 28px",
              borderBottom: "1px solid var(--line-soft)",
            }}
          >
            <span className="nowrap" style={{ fontSize: 12, color: "var(--ink-3)", marginRight: 4 }}>
              {t.result.showPeople}
            </span>
            {chips.map((c) => {
              const on = !hidden[peopleKey(c.name)];
              return (
                <button
                  key={peopleKey(c.name)}
                  type="button"
                  className={`check-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleHidden(c.name)}
                >
                  <span className="check-box">{on ? "✓" : ""}</span>
                  <span className="dot" style={{ width: 8, height: 8, background: c.name === null ? NO_NAME_DOT : colorOf(c.name) }} />
                  {c.name === null ? t.common.noName : t.engine.speakerLabel(c.name)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={showAllPeople}
              style={{
                flex: "none",
                whiteSpace: "nowrap",
                font: "inherit",
                fontSize: 12,
                padding: "4px 8px",
                border: "none",
                background: "transparent",
                color: "var(--accent)",
                cursor: "pointer",
              }}
            >
              {t.result.showAll}
            </button>
            <span className="nowrap" style={{ fontSize: 12, color: "var(--ink-4)", marginLeft: "auto" }}>
              {shownPeople === chips.length
                ? t.result.rows(formatCount(visible.length))
                : t.result.shownOf(chips.length, shownPeople, formatCount(visible.length))}
            </span>
          </div>

          {/* 書き起こしの繰り返しの注意（約束 版4。本文の上に注意の帯。押すとその時刻の行へ） */}
          {repeats.length ? (
            <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 6, padding: "10px 28px", borderBottom: "1px solid var(--line-soft)" }}>
              {repeats.map((n) => (
                <button
                  key={`${n.startSec}-${n.endSec}`}
                  type="button"
                  className="band-warn"
                  title={t.result.repeatTitle}
                  onClick={() => jumpToTime(n.startSec)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                    textAlign: "left",
                    border: "none",
                    padding: "8px 12px",
                    font: "inherit",
                    fontSize: 13,
                    lineHeight: 1.6,
                    cursor: "pointer",
                  }}
                >
                  <span>{t.engine.repeat(n)}</span>
                  <span className="nowrap" style={{ fontSize: 12 }}>
                    {t.result.repeatGo}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <TranscriptList
            rows={visible}
            colorOf={colorOf}
            query={search}
            currentMatchId={currentMatchId}
            matchIndex={matchIndex}
            durationSec={durationSec}
            jobId={jobId}
            playable={playable}
          />
        </div>

        {/* 右: 確認用の欄 */}
        <div style={{ minHeight: 0, overflow: "auto", padding: "20px 22px 28px", display: "flex", flexDirection: "column", gap: 22 }}>
          <UnresolvedPanel rows={rows} durationSec={durationSec} />
        </div>
      </div>

      {/* 保存の帯・「詳細」の窓・元のファイルの帯は、「話者」「文字起こし」のどちらのタブでも出すので、録音の枠が出す（objects/MainPane・RecordingHeader） */}
      <NameMenu rows={rows} colorOf={colorOf} durationSec={durationSec} />
    </div>
  );
}
