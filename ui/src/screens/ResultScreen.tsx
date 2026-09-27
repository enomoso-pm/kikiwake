// 画面5 結果（UI 画面仕様書 §8）
import { useMemo } from "react";
import { ErrorBand } from "../components/ErrorBand";
import { useT } from "../i18n";
import { FREE_NAME_COLOR, NO_NAME_COLOR, NO_NAME_DOT, labelColors } from "../lib/colors";
import { basename, formatClock, formatCount } from "../lib/format";
import { isPlainEnter } from "../lib/keys";
import { nameKey } from "../lib/names";
import { buildRows, peopleOf, resultStats, searchMatches, talkTimes } from "../lib/transcript";
import { relinkSource } from "../store/history";
import { finish } from "../store/leave";
import { goToNamingFor } from "../store/naming";
import {
  jumpToTime,
  moveMatch,
  openDetail,
  peopleKey,
  requestRevertAll,
  setSearch,
  showAllPeople,
  toggleHidden,
} from "../store/result";
import { useApp } from "../store/state";
import { DetailModal } from "./result/DetailModal";
import { NameMenu } from "./result/NameMenu";
import { SaveBar } from "./result/SaveBar";
import { TranscriptList } from "./result/TranscriptList";
import { UnresolvedPanel } from "./result/UnresolvedPanel";

export function ResultScreen() {
  const t = useT();
  const view = useApp((s) => s.view);
  const lineNames = useApp((s) => s.lineNames);
  const confirmed = useApp((s) => s.confirmed);
  const textHistory = useApp((s) => s.textHistory);
  const hidden = useApp((s) => s.hidden);
  const search = useApp((s) => s.search);
  const matchIndex = useApp((s) => s.matchIndex);
  const speakers = useApp((s) => s.speakers);
  const appliedNames = useApp((s) => s.appliedNames);
  const fileName = useApp((s) => s.file?.name);
  const jobId = useApp((s) => s.job?.jobId ?? null);
  const saveError = useApp((s) => s.saveError);
  const playable = useApp((s) => s.playable);
  const relinkError = useApp((s) => s.relinkError);

  const rows = useMemo(
    () => (view ? buildRows(view, lineNames, confirmed, textHistory) : []),
    [view, lineNames, confirmed, textHistory],
  );
  const talk = useMemo(() => (view ? talkTimes(view, rows) : []), [view, rows]);
  const people = useMemo(() => peopleOf(rows, talk), [rows, talk]);
  const stats = useMemo(() => resultStats(rows), [rows]);

  // 名前の色: ラベルの色（まとめた人は最初のラベルの色）。この画面で入力した名前は灰色
  const colorOf = useMemo(() => {
    const labels = speakers.map((c) => c.label);
    const byLabel = labelColors(labels);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
    const map = new Map<string, string>();
    for (const label of sorted) {
      const k = nameKey(appliedNames[label] || label);
      if (!map.has(k)) map.set(k, byLabel[label]);
    }
    return (name: string | null) => (name === null ? NO_NAME_COLOR : map.get(nameKey(name)) ?? FREE_NAME_COLOR);
  }, [speakers, appliedNames]);

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
      {/* 上の帯 */}
      <div
        style={{
          flex: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          padding: "20px 28px 16px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <button
            type="button"
            className="btn-link nowrap"
            onClick={() => goToNamingFor(null)}
            style={{ alignSelf: "flex-start", font: "inherit", fontSize: 13, padding: "2px 0", cursor: "pointer" }}
          >
            {t.result.backToNaming}
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>{t.result.title}</h1>
          <span className="nowrap num" style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {t.result.meta(fileName ?? basename(view.source), formatClock(durationSec), talk.length, formatCount(stats.rows), formatCount(stats.chars))}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
          <span className="nowrap" style={{ fontSize: 12, color: "var(--ink-4)" }}>
            {t.result.editableNote}
          </span>
          <button type="button" className="btn btn-mid" onClick={openDetail}>
            {t.result.details}
          </button>
          {/* 保存したかどうかに関係なく押せる（2026-09-26 決定。仕様書に無い）。完了の画面は工程の外 */}
          <button type="button" className="btn btn-mid" onClick={finish}>
            {t.result.finish}
          </button>
        </div>
      </div>

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

          {/* 履歴から元ファイルの無い録音を開いた（約束 版8）。書き起こしは読めるが行の再生はできない。選び直すと再生できる */}
          {!playable ? (
            <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 6, padding: "10px 28px", borderBottom: "1px solid var(--line-soft)" }}>
              <div
                className="band-warn"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 12px", fontSize: 13, lineHeight: 1.6 }}
              >
                <span className="pretty">{t.history.missingBand}</span>
                <button type="button" className="btn btn-small" onClick={() => void relinkSource()}>
                  {t.history.relink}
                </button>
              </div>
              {relinkError ? <ErrorBand error={relinkError} /> : null}
            </div>
          ) : null}

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

      {saveError ? (
        <div style={{ flex: "none", padding: "10px 32px", borderTop: "1px solid var(--line)", background: "var(--bg-bar)" }}>
          <ErrorBand error={saveError} small />
        </div>
      ) : null}

      <SaveBar />
      <NameMenu rows={rows} colorOf={colorOf} durationSec={durationSec} />
      <DetailModal talk={talk} stats={stats} labelCount={speakers.length} colorOf={colorOf} />
    </div>
  );
}
