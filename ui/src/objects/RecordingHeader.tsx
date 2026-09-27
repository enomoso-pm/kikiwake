// 案A: 右の録音の上の段。情報（処理日・長さ・話者の数・場所）、元のファイルの帯、「話者」「文字起こし」の切り替えと操作。
// 名前と状態の印は、その上の帯（Toolbar）に出す
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HistoryItem } from "@contract/types";
import { ErrorBand } from "../components/ErrorBand";
import { useT } from "../i18n";
import { basename, formatClock, formatMonthDay } from "../lib/format";
import { requestCancel } from "../store/job";
import { navigateStep } from "../store/naming";
import { useApp, useIsMac } from "../store/state";
import { MoreIcon } from "./icons";
import { namedOf, sourceOf, volumeOf, type Entry } from "./model";
import { useLive } from "./selection";
import {
  deleteEntry,
  dequeue,
  dismissNotice,
  openDetails,
  relinkPick,
  relinkSamePath,
  retranscribe,
  revealPath,
  revealSavedFiles,
  useObjects,
} from "./store";

export type Tab = "speakers" | "transcript";

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function MoreMenu({ items }: { items: MenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="objects-icon-btn"
        title={t.objects.more}
        aria-label={t.objects.more}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="objects-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? "danger" : undefined}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 録音の上の注意の帯。狭い窓でも中身が隠れないよう、題と説明は1続きの文にして、ボタンと失敗の一言は下の段にまとめる */
function Band({ title, body, error, children }: { title: string; body: ReactNode; error?: string | null; children?: ReactNode }) {
  return (
    <div className="band-warn" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px" }}>
      <span className="pretty" style={{ fontSize: 13, lineHeight: 1.65 }}>
        <strong style={{ fontWeight: 600 }}>{title}</strong>
        {"　"}
        {body}
      </span>
      {children || error ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {children}
          {error ? (
            <span role="alert" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--err-ink)" }}>
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 元のファイルが見つからない・変わったときの帯（何が残っていて、何ができず、次に何をすればよいか） */
function SourceBand({ item, open, playable }: { item: HistoryItem; open: boolean; playable: boolean | null }) {
  const t = useT();
  const s = t.objects.source;
  const relinkError = useApp((st) => st.relinkError);
  const state = sourceOf({ kind: "history", key: `h:${item.jobId}`, item }, open ? playable : null);
  if (state === "ok") return null;
  const unfinished = item.status === "unfinished";
  const volume = volumeOf(item.path);
  const error = open && relinkError ? t.engine.error(relinkError) : null;
  if (state === "missing") {
    return (
      <Band
        title={s.missing}
        error={error}
        body={
          unfinished ? (
            s.unfinishedMissing
          ) : (
            <>
              {s.missingBody}
              {volume ? <> {s.missingVolume(volume)}</> : null}
            </>
          )
        }
      >
        {open && !unfinished ? (
          <button type="button" className="btn btn-small" onClick={() => void relinkPick()}>
            {s.relinkPick}
          </button>
        ) : null}
      </Band>
    );
  }
  return (
    <Band title={s.changed} body={unfinished ? s.unfinishedChanged : s.changedBody} error={error}>
      {open && !unfinished ? (
        <button type="button" className="btn btn-small" onClick={() => void relinkSamePath(item.path)}>
          {s.relinkSame}
        </button>
      ) : null}
      <button type="button" className="btn btn-small" onClick={() => void retranscribe(item.path)}>
        {s.retranscribe}
      </button>
    </Band>
  );
}

export function RecordingHeader({ entry, tab }: { entry: Entry | null; tab: Tab | null }) {
  const t = useT();
  const o = t.objects;
  const isMac = useIsMac();
  const job = useApp((s) => s.job);
  const saved = useApp((s) => s.saved);
  const applying = useApp((s) => s.applying);
  const notice = useObjects((s) => s.notice);
  const openError = useObjects((s) => s.openError);
  const { live, playable } = useLive(entry);

  const open = Boolean(entry?.kind === "history" && job?.status === "done" && job.jobId === entry.item.jobId && playable !== null);
  const viewingRunning = Boolean(entry?.kind === "running" && job?.status === "running");

  let meta: string[] = [];
  let path = job?.path ?? "";
  if (entry?.kind === "history") {
    const it = entry.item;
    const day = formatMonthDay(it.processedAt);
    meta = [
      day ? o.processedOn(day) : "",
      it.durationSec > 0 ? formatClock(it.durationSec) : "",
      it.speakers != null ? o.speakers(it.speakers, namedOf(entry, live)) : "",
    ];
    path = it.path;
  } else if (entry?.kind === "running") {
    meta = [entry.durationSec > 0 ? formatClock(entry.durationSec) : "", t.engine.stage(entry.job.stage)];
    path = entry.path;
  } else if (entry?.kind === "queued") {
    meta = [entry.item.durationSec > 0 ? formatClock(entry.item.durationSec) : ""];
    path = entry.item.path;
  }

  const items: MenuItem[] = [];
  if (entry?.kind === "history") {
    const it = entry.item;
    const source = sourceOf(entry, open ? playable : null);
    if (open && saved?.files.length) items.push({ label: o.menu.revealSaved(isMac), onClick: () => void revealSavedFiles() });
    if (source === "ok") items.push({ label: o.menu.revealSource(isMac), onClick: () => void revealPath(it.path) });
    if (open && source !== "ok") items.push({ label: o.menu.relink, onClick: () => void relinkPick() });
    items.push({ label: o.menu.delete, onClick: () => deleteEntry(it), danger: true });
  } else if (entry?.kind === "running" && viewingRunning) {
    items.push({ label: o.menu.cancel, onClick: requestCancel, danger: true });
  } else if (entry?.kind === "queued") {
    const id = entry.item.id;
    items.push({ label: o.menu.dequeue, onClick: () => dequeue(id) });
  }

  return (
    <div className="objects-head">
      <div className="objects-meta">
        <span className="num nowrap">{o.meta(meta.filter(Boolean))}</span>
        <span className="mono ellipsis" title={path} style={{ minWidth: 0, fontSize: 12, color: "var(--ink-4)" }}>
          {path || (job ? basename(job.path) : "")}
        </span>
      </div>

      {entry?.kind === "history" ? <SourceBand item={entry.item} open={open} playable={playable} /> : null}

      {notice?.kind === "savedMissing" ? (
        <Band title={o.savedMissingTitle} body={o.savedMissingBody}>
          {tab !== "transcript" ? (
            <button type="button" className="btn btn-small" onClick={() => navigateStep("result")}>
              {o.toTranscript}
            </button>
          ) : null}
          <button type="button" className="btn btn-small" onClick={dismissNotice}>
            {o.dismiss}
          </button>
        </Band>
      ) : null}
      {notice?.kind === "error" ? <ErrorBand error={notice.error} /> : null}
      {openError ? <ErrorBand error={openError.error} /> : null}

      <div className="objects-head-row">
        <div className="objects-tabs" role="tablist" aria-label={o.tabs.aria}>
          <button
            type="button"
            role="tab"
            className={`objects-tab${tab === "speakers" ? " current" : ""}`}
            aria-selected={tab === "speakers"}
            disabled={!tab || applying}
            onClick={() => tab !== "speakers" && navigateStep("naming")}
          >
            {o.tabs.speakers}
          </button>
          <button
            type="button"
            role="tab"
            className={`objects-tab${tab === "transcript" ? " current" : ""}`}
            aria-selected={tab === "transcript"}
            disabled={!tab || applying}
            onClick={() => tab !== "transcript" && navigateStep("result")}
          >
            {o.tabs.transcript}
          </button>
        </div>
        {/* 「詳細」は話者・文字起こしのどちらのタブでも出す（2026-09-27）。この段の高さは、出すボタンによらず同じ（切り替えても下が動かない） */}
        <div className="objects-actions">
          {tab ? (
            <button type="button" className="btn btn-small" disabled={applying} onClick={() => void openDetails()}>
              {t.result.details}
            </button>
          ) : null}
          <MoreMenu items={items} />
        </div>
      </div>
    </div>
  );
}
