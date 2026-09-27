// 履歴の画面（約束 版8。2026-09-27 決定。仕様書に無い）。ファイルの画面の「履歴」から入る（工程バーでは「1 ファイル」の中）。
// 前に文字起こしした録音を最後に使った順に並べ、開く（書き終えたもの）・続きから（途中のもの）・消す（確かめてから）。
// 部品はファイルの画面のカード（左に名前と情報、右にボタン）・帯と、完了の画面の「←」の戻り方と同じ形
import type { HistoryItem } from "@contract/types";
import { ErrorBand } from "../components/ErrorBand";
import { useT } from "../i18n";
import { formatClock, formatMonthDay } from "../lib/format";
import { backToFileScreen, openHistoryItem, requestDeleteHistory } from "../store/history";
import { useApp } from "../store/state";

function Row({ item }: { item: HistoryItem }) {
  const t = useT();
  const h = t.history;
  const opening = useApp((s) => s.historyOpening);
  const busy = opening === item.jobId;
  const unfinished = item.status === "unfinished";
  const day = formatMonthDay(item.processedAt);
  const meta = [
    item.durationSec > 0 ? formatClock(item.durationSec) : null,
    item.speakers != null ? h.speakers(item.speakers) : null,
    item.named ? h.named : null,
    day,
  ].filter((x): x is string => Boolean(x));
  // 途中の録音は元ファイルが無いと続きから処理できない（書き終えた録音は、元ファイルが無くても開ける）
  const canOpen = !unfinished || item.sourceAvailable;
  const notes: Array<{ text: string; tone: "warn" | "info" }> = [];
  if (unfinished) notes.push({ text: h.meta([h.unfinished, item.diarizationKept ? h.unfinishedDiar : h.unfinishedNone]), tone: "warn" });
  if (!item.sourceAvailable) notes.push({ text: h.missing(unfinished), tone: "warn" });
  if (item.unsavedEdits) notes.push({ text: h.unsaved, tone: "info" });

  return (
    <div
      className="card"
      data-history-id={item.jobId}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 20px" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 600, overflowWrap: "anywhere" }}>{item.name}</span>
        <span className="num" style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {h.meta(meta)}
        </span>
        {notes.map((n) => (
          <span
            key={n.text}
            className="pretty"
            style={{ fontSize: 13, lineHeight: 1.6, color: n.tone === "warn" ? "var(--warn-ink)" : "var(--accent-soft-ink)" }}
          >
            {n.text}
          </span>
        ))}
        <span className="mono ellipsis" title={item.path} style={{ fontSize: 12, color: "var(--ink-4)" }}>
          {item.path}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <button
          type="button"
          className="btn btn-mid"
          disabled={!canOpen || Boolean(opening)}
          onClick={() => void openHistoryItem(item)}
        >
          {busy ? h.opening : unfinished ? h.resume : h.openItem}
        </button>
        <button type="button" className="btn btn-mid" disabled={Boolean(opening)} onClick={() => requestDeleteHistory(item)}>
          {h.delete}
        </button>
      </div>
    </div>
  );
}

export function HistoryScreen() {
  const t = useT();
  const history = useApp((s) => s.history);
  const error = useApp((s) => s.historyError);

  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            className="btn-link nowrap"
            onClick={backToFileScreen}
            style={{ alignSelf: "flex-start", font: "inherit", fontSize: 13, padding: "2px 0", cursor: "pointer" }}
          >
            {t.history.back}
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>{t.history.title}</h1>
          <p className="pretty" style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.75 }}>
            {t.history.lead}
          </p>
        </div>

        {error ? <ErrorBand error={error} /> : null}

        {history && history.length === 0 ? (
          <div className="card" style={{ padding: "18px 20px", fontSize: 14, color: "var(--ink-3)" }}>
            {t.history.empty}
          </div>
        ) : null}
        {history?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {history.map((item) => (
              <Row key={item.jobId} item={item} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
