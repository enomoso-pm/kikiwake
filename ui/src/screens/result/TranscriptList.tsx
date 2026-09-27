// 本文の一覧（UI 画面仕様書 §8.5）。見えている範囲だけを描く（行の高さは折り返しで変わる）
import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { formatTimestamp } from "@contract/format";
import { api } from "../../api";
import { PlayProgress } from "../../components/PlayButton";
import { useT } from "../../i18n";
import { NO_NAME_COLOR } from "../../lib/colors";
import { isCommitKey, isEscape } from "../../lib/keys";
import { togglePlayback, usePlayer } from "../../lib/player";
import { highlightParts, type Row } from "../../lib/transcript";
import {
  cancelEdit,
  commitEdit,
  openNameMenu,
  setEditValue,
  startEditText,
  undoText,
} from "../../store/result";
import { useApp, useIsMac } from "../../store/state";

const rowKey = (id: string) => `row:${id}`;

interface RowProps {
  row: Row;
  color: string;
  query: string;
  current: boolean;
  flash: boolean;
  editing: boolean;
  editValue: string;
  menuOpen: boolean;
  mod: string;
  durationSec: number;
  jobId: string | null;
  /** 版8: 履歴から元ファイルの無い録音を開いたら false（行の再生はできない） */
  playable: boolean;
}

const RowView = memo(function RowView({ row, color, query, current, flash, editing, editValue, menuOpen, mod, durationSec, jobId, playable }: RowProps) {
  const t = useT();
  const playKey = rowKey(row.id);
  const playing = usePlayer((p) => p.key === playKey);
  const background = flash ? "var(--flash)" : current ? "var(--hit-row)" : row.pending ? "var(--unres-bg)" : "transparent";
  const nameLine = row.overridden
    ? "1px dashed var(--accent)"
    : row.pending
      ? "1px dashed var(--unres-dash)"
      : "1px solid transparent";
  const nameTip = row.overridden ? t.transcript.nameTipOverridden(t.engine.speakerLabel(row.labelName ?? "")) : t.transcript.nameTip;
  const onPlay = () => {
    if (!jobId || !playable) return;
    togglePlayback(playKey, () => api.recordingSrc(jobId, row.start, row.end));
  };
  const onNameDouble = (e: MouseEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    openNameMenu(row.id, { left: r.left, top: r.top, bottom: r.bottom });
  };

  return (
    <div
      data-row-id={row.id}
      style={{
        display: "grid",
        gridTemplateColumns: "24px 64px 96px minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "start",
        padding: "5px 20px",
        background,
      }}
    >
      <button
        type="button"
        title={!playable ? t.objects.playDisabled : playing ? t.transcript.stopLine : t.transcript.playLine}
        disabled={!playable}
        onClick={onPlay}
        style={{
          marginTop: 2,
          width: 24,
          height: 22,
          padding: 0,
          borderRadius: 5,
          border: `1px solid ${playing ? "var(--accent)" : "var(--line-input)"}`,
          background: playing ? "var(--accent)" : "#fff",
          color: playing ? "#fff" : !playable ? "var(--disabled)" : "var(--ink-2)",
          fontSize: 9,
          cursor: playable ? "pointer" : "default",
        }}
      >
        {playing ? "■" : "▶"}
      </button>
      <span className="mono" style={{ fontSize: 12, lineHeight: "26px", color: "var(--ink-4)" }}>
        {formatTimestamp(row.start, durationSec)}
      </span>
      <div style={{ minWidth: 0, position: "relative" }}>
        <span
          data-name="1"
          title={nameTip}
          onDoubleClick={onNameDouble}
          style={{
            fontSize: 14,
            lineHeight: "26px",
            fontWeight: 600,
            color: row.name ? color : NO_NAME_COLOR,
            borderBottom: nameLine,
            background: menuOpen ? "var(--focus)" : "transparent",
            borderRadius: 2,
            cursor: "pointer",
            userSelect: "none",
            overflowWrap: "anywhere",
          }}
        >
          {(row.name === null ? t.common.noName : t.engine.speakerLabel(row.name)) + (row.overlap ? "*" : "")}
        </span>
      </div>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {editing ? (
          <>
            <textarea
              autoFocus
              rows={2}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onFocus={(e) => {
                const t = e.currentTarget;
                t.setSelectionRange(t.value.length, t.value.length);
              }}
              onKeyDown={(e) => {
                if (isCommitKey(e)) {
                  e.preventDefault();
                  commitEdit();
                } else if (isEscape(e)) {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              onBlur={commitEdit}
              style={{
                width: "100%",
                boxSizing: "border-box",
                font: "inherit",
                fontSize: 15,
                lineHeight: "24px",
                padding: "3px 8px",
                borderRadius: 5,
                border: "1px solid var(--accent)",
                outline: "none",
                boxShadow: "0 0 0 3px var(--focus)",
                resize: "vertical",
                color: "var(--ink)",
                background: "#fff",
              }}
            />
            <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{t.transcript.editKeys(mod)}</span>
          </>
        ) : (
          <span
            title={t.transcript.editTip}
            onDoubleClick={() => startEditText(row.id)}
            style={{ fontSize: 15, lineHeight: "26px", cursor: "text", overflowWrap: "anywhere" }}
          >
            {highlightParts(row.text, query).map((p, i) =>
              p.hit ? (
                <span key={i} style={{ background: "var(--hit)", borderRadius: 2 }}>
                  {p.text}
                </span>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </span>
        )}
        {playing ? <PlayProgress playKey={playKey} /> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 26 }}>
        {row.history.length ? (
          <>
            <span
              title={t.transcript.originalTip(row.original)}
              className="nowrap"
              style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "var(--accent-soft)", color: "var(--accent-soft-ink)" }}
            >
              {t.transcript.edited}
            </span>
            <button
              type="button"
              className="nowrap"
              title={row.history.length > 1 ? t.transcript.undoTipPrev(row.history[row.history.length - 2]) : t.transcript.undoTipOriginal(row.original)}
              onClick={() => undoText(row.id)}
              style={{
                font: "inherit",
                fontSize: 12,
                padding: "3px 8px",
                borderRadius: 5,
                border: "1px solid var(--line-input)",
                background: "#fff",
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              {t.transcript.undo}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
});

export interface TranscriptListProps {
  rows: Row[];
  colorOf: (name: string | null) => string;
  query: string;
  currentMatchId: string | null;
  matchIndex: number;
  durationSec: number;
  jobId: string | null;
  playable: boolean;
}

export function TranscriptList({ rows, colorOf, query, currentMatchId, matchIndex, durationSec, jobId, playable }: TranscriptListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const editing = useApp((s) => s.editing);
  const menuId = useApp((s) => s.nameMenu?.id ?? null);
  const flashId = useApp((s) => s.flashId);
  const scrollRequest = useApp((s) => s.scrollRequest);
  const playKey = usePlayer((p) => p.key);
  const mod = useIsMac() ? "⌘" : "Ctrl";

  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  // 編集中・名前を選ぶ欄を出している・再生中の行は、見えていなくても描いたままにする
  const keep: number[] = [];
  for (const id of [editing?.id, menuId, playKey?.startsWith("row:") ? playKey.slice(4) : undefined]) {
    const i = id ? indexById.get(id) : undefined;
    if (i !== undefined) keep.push(i);
  }
  const keepRef = useRef(keep);
  keepRef.current = keep;

  const rangeExtractor = useCallback((range: Range) => {
    const out = defaultRangeExtractor(range);
    for (const i of keepRef.current) if (!out.includes(i)) out.push(i);
    return out.sort((a, b) => a - b);
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 8,
    paddingStart: 6,
    paddingEnd: 24,
    getItemKey: (i) => rows[i]?.id ?? i,
    rangeExtractor,
  });

  /** その行が一覧の上から3分の1あたりに来るように流す（行の高さが測れるまで数回合わせる） */
  const scrollToThird = useCallback(
    (index: number, done?: () => void) => {
      const el = parentRef.current;
      if (!el) return;
      let tries = 0;
      const step = () => {
        const off = virtualizer.getOffsetForIndex(index, "start");
        const start = off ? off[0] : 0;
        const target = Math.max(0, start - el.clientHeight / 3);
        if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
        tries++;
        requestAnimationFrame(() => {
          const again = virtualizer.getOffsetForIndex(index, "start");
          if (tries < 6 && again && Math.abs(again[0] - start) > 1) step();
          else requestAnimationFrame(() => done?.());
        });
      };
      step();
    },
    [virtualizer],
  );

  // 今いる一致が変わったら流す（§8.3）
  useEffect(() => {
    if (!currentMatchId) return;
    const i = indexById.get(currentMatchId);
    if (i !== undefined) scrollToThird(i);
  }, [currentMatchId, query, matchIndex]);

  // 確認用の欄・繰り返しの帯から「この行へ」（§8.7）
  useEffect(() => {
    if (!scrollRequest) return;
    const i = indexById.get(scrollRequest.id);
    if (i === undefined) return;
    scrollToThird(i, () => {
      if (!scrollRequest.openMenu) return;
      const sel = `[data-row-id="${CSS.escape(scrollRequest.id)}"] [data-name]`;
      const nameEl = parentRef.current?.querySelector<HTMLElement>(sel);
      if (nameEl) {
        const r = nameEl.getBoundingClientRect();
        openNameMenu(scrollRequest.id, { left: r.left, top: r.top, bottom: r.bottom });
      }
    });
  }, [scrollRequest?.seq]);

  return (
    <div ref={parentRef} style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          const isEditing = editing?.id === row.id;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
            >
              <RowView
                row={row}
                color={colorOf(row.name)}
                query={query}
                current={row.id === currentMatchId}
                flash={row.id === flashId}
                editing={isEditing}
                editValue={isEditing ? editing.value : ""}
                menuOpen={row.id === menuId}
                mod={mod}
                durationSec={durationSec}
                jobId={jobId}
                playable={playable}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
