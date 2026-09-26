// 画面2 ファイル選択（UI 画面仕様書 §5）。ドロップは api.onFileDrop で受ける（store/file.ts）。
// アプリの中ではドラッグ中の知らせも api.onFileDragOver で届く（HTML5 の知らせは届かない。約束 版6）。枠は data-drop-zone で探す
import type { DragEvent } from "react";
import { ErrorBand } from "../components/ErrorBand";
import { fileFormatLabel, formatClock, formatEstimate, formatFileSize, formatMonthDay } from "../lib/format";
import { clearFile, pickFile, setDragOver } from "../store/file";
import { startJob } from "../store/job";
import { useApp } from "../store/state";

function DropZone() {
  const over = useApp((s) => s.dragOver);
  // 見た目が変わるのは枠の上だけ。ファイルは窓のどこに落としても受ける（onFileDrop）
  const onOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  };
  return (
    <div
      data-drop-zone=""
      onDragEnter={onOver}
      onDragOver={onOver}
      onDragLeave={onLeave}
      onDrop={() => setDragOver(false)}
      style={{
        height: 300,
        border: `2px dashed ${over ? "var(--accent)" : "var(--drop-line)"}`,
        background: over ? "var(--drop-hover)" : "#fff",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
      }}
    >
      <span style={{ fontSize: 18, fontWeight: 600 }}>録音をここにドラッグ</span>
      <span style={{ fontSize: 13, color: "var(--ink-3)" }}>または</span>
      <button type="button" className="btn btn-secondary compact" onClick={() => void pickFile()}>
        ファイルを選ぶ
      </button>
      <span style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 6 }}>対応形式：mp4・mov・m4a（ボイスメモ）・mp3・wav</span>
    </div>
  );
}

export function FileScreen() {
  const file = useApp((s) => s.file);
  const fileError = useApp((s) => s.fileError);
  const startError = useApp((s) => s.startError);

  const previousDay = file?.previous?.diarizationReusable ? formatMonthDay(file.previous.processedAt) : null;

  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>録音を選ぶ</h1>

        {!file ? (
          <>
            <DropZone />
            {fileError ? <ErrorBand error={fileError} copy={false} /> : null}
          </>
        ) : (
          <>
            <div
              className="card"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 20px" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600, overflowWrap: "anywhere" }}>{file.name}</span>
                <span className="num" style={{ fontSize: 13, color: "var(--ink-3)" }}>
                  {formatClock(file.durationSec)} ・ {formatFileSize(file.sizeBytes)} ・ {fileFormatLabel(file.name)}
                </span>
                <span className="mono ellipsis" title={file.path} style={{ fontSize: 12, color: "var(--ink-4)" }}>
                  {file.path}
                </span>
              </div>
              <button type="button" className="btn btn-mid" onClick={clearFile}>
                別のファイルにする
              </button>
            </div>

            {file.previous?.resultReusable ? (
              // 版6: 前回の書き起こしまでそろっている（2026-09-26 決定。仕様書に無い）
              <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>前回の結果を使います</span>
                <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
                  {previousDay ? `この録音は ${previousDay} に一度処理しています。` : "この録音は一度処理しています。"}
                  書き起こしをやり直さずに、すぐに名前付けへ進みます。前回名前を付けていれば、その名前が入っています。
                </span>
              </div>
            ) : file.previous?.diarizationReusable ? (
              <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>前回の話者判定を使います</span>
                <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
                  {previousDay ? `この録音は ${previousDay} に一度処理しています。` : "この録音は一度処理しています。"}
                  話者の判定は前回の結果をそのまま使い、書き起こしから始めます。
                </span>
              </div>
            ) : null}

            <div className="card" style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "14px 18px" }}>
              <span className="nowrap" style={{ fontSize: 13, color: "var(--ink-3)" }}>
                所要時間の目安
              </span>
              <strong className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                {file.previous?.resultReusable ? "すぐに終わります" : formatEstimate(file.estimate.minSec, file.estimate.maxSec)}
              </strong>
            </div>

            {startError ? <ErrorBand error={startError} /> : null}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-primary" onClick={() => void startJob()}>
                文字起こしを始める
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
