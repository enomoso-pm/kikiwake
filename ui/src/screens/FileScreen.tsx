// 「＋ 新しい録音」: ファイル選択（UI 画面仕様書 §5）。ドロップは api.onFileDrop で受ける（store/file.ts）。
// アプリの中ではドラッグ中の知らせも api.onFileDragOver で届く（HTML5 の知らせは届かない。約束 版6）。枠は data-drop-zone で探す
import { useId, type DragEvent, type ReactNode } from "react";
import { ErrorBand } from "../components/ErrorBand";
import { UpdateBand } from "../components/UpdateBand";
import { useT } from "../i18n";
import { fileFormatLabel, formatClock, formatEstimate, formatFileSize, formatMonthDay } from "../lib/format";
import { clearFile, pickFile, setDragOver, setScreensOn, setSpeechChoice } from "../store/file";
import { useApp, type SpeechChoice } from "../store/state";

function DropZone() {
  const t = useT();
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
      <span style={{ fontSize: 18, fontWeight: 600 }}>{t.file.dropHere}</span>
      <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{t.file.or}</span>
      <button type="button" className="btn btn-secondary compact" onClick={() => void pickFile()}>
        {t.file.pick}
      </button>
      <span style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 6 }}>{t.file.formats}</span>
    </div>
  );
}

/**
 * 「＋ 新しい録音」の画面。前に文字起こしした録音は左の一覧にあるので、ここには出さない。
 * 処理中の録音があれば、はじめると順番待ちに入る（2026-09-27 決定）
 */
export interface FileScreenProps {
  /** 処理中の録音の名前（あれば、はじめると順番待ちに入る） */
  runningName: string | null;
  start: () => void;
  /** 選んだファイルについての知らせ（前に文字起こしした場所のファイルが変わった など） */
  notice?: ReactNode;
}

export function FileScreen({ runningName, start, notice }: FileScreenProps) {
  const t = useT();
  const file = useApp((s) => s.file);
  const fileError = useApp((s) => s.fileError);
  const startError = useApp((s) => s.startError);
  const screensOn = useApp((s) => s.screensOn);
  const choice = useApp((s) => s.speechChoice);
  const languageId = useId();

  const previousDay = file?.previous?.diarizationReusable ? formatMonthDay(file.previous.processedAt) : null;
  // 版15: 前回の書き起こしと違う言語を選んだら、書き起こしからやり直す（声の聞き分けは使い回す）。自動なら前回の言語のまま
  const previousLanguage = file?.previous?.language;
  const relang = choice !== "auto" && previousLanguage !== undefined && previousLanguage !== choice ? { before: previousLanguage, after: choice } : null;
  const reuseResult = Boolean(file?.previous?.resultReusable) && !relang;
  // 版13: マニュアル用にするときの所要時間の目安（画面の読み取りは文字起こしと同時に進める）
  const screensEstimate = screensOn && file?.hasVideo ? file.estimateScreens : undefined;
  const estimate = relang && file?.previous?.estimateRedo ? file.previous.estimateRedo : file?.estimate;

  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>{t.objects.newTitle}</h1>
        {/* 新しい版の知らせ（約束 版10）。ファイルを選ぶ前も後も出す（消すまで） */}
        <UpdateBand />

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
                  {t.file.meta(formatClock(file.durationSec), formatFileSize(file.sizeBytes), fileFormatLabel(file.name))}
                </span>
                <span className="mono ellipsis" title={file.path} style={{ fontSize: 12, color: "var(--ink-4)" }}>
                  {file.path}
                </span>
              </div>
              <button type="button" className="btn btn-mid" onClick={clearFile}>
                {t.file.another}
              </button>
            </div>

            {notice ?? null}

            {relang ? (
              // 版15: 前回と違う言語を選んだ（書き起こしからやり直す。2026-10-18）
              <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t.file.relangTitle}</span>
                <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
                  {t.file.relangBody(relang.before, relang.after)}
                </span>
              </div>
            ) : reuseResult ? (
              // 版6: 前回の書き起こしまでそろっている（2026-09-26 決定。仕様書に無い）
              <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t.file.reuseResultTitle}</span>
                <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
                  {previousDay ? t.file.processedOn(previousDay) : t.file.processedBefore}
                  {t.file.reuseResultBody}
                </span>
              </div>
            ) : file.previous?.diarizationReusable ? (
              <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t.file.reuseDiarTitle}</span>
                <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
                  {previousDay ? t.file.processedOn(previousDay) : t.file.processedBefore}
                  {t.file.reuseDiarBody}
                </span>
              </div>
            ) : null}

            {/* 版13: 録画（映像あり）のときだけ。初めは外れている（2026-10-12 決定） */}
            {file.hasVideo ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={screensOn}
                className={`card screens-option${screensOn ? " on" : ""}`}
                onClick={() => setScreensOn(!screensOn)}
              >
                <span className="check-box">{screensOn ? "✓" : ""}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t.file.screens}</span>
                  <span className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7 }}>
                    {t.file.screensHint}
                  </span>
                </span>
              </button>
            ) : null}

            {/* 版15: 録音の言語（2026-10-18 決定: 自動で見分ける＋選び直せる。初めは毎回「自動」で、前に選んだものは覚えない） */}
            <div className="card speech-option">
              <label htmlFor={languageId} className="nowrap" style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {t.file.language}
              </label>
              <select
                id={languageId}
                className="speech-select"
                value={choice}
                onChange={(e) => setSpeechChoice(e.target.value as SpeechChoice)}
              >
                <option value="auto">{t.file.languageAuto}</option>
                <option value="ja">{t.file.languageOption("ja")}</option>
                <option value="en">{t.file.languageOption("en")}</option>
              </select>
              {choice === "auto" ? (
                <span className="pretty" style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.6 }}>
                  {t.file.languageAutoHint}
                </span>
              ) : null}
            </div>

            <div className="card" style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "14px 18px" }}>
              <span className="nowrap" style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {t.file.estimate}
              </span>
              <strong className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                {screensEstimate && !relang
                  ? formatEstimate(screensEstimate.minSec, screensEstimate.maxSec)
                  : reuseResult
                    ? t.file.soon
                    : formatEstimate((estimate ?? file.estimate).minSec, (estimate ?? file.estimate).maxSec)}
              </strong>
            </div>

            {startError ? <ErrorBand error={startError} /> : null}

            {runningName ? (
              <div className="band-info pretty" style={{ padding: "12px 18px", fontSize: 13, lineHeight: 1.7 }}>
                {t.objects.queueNote(runningName)}
              </div>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-primary" onClick={start}>
                {runningName ? t.objects.enqueue : t.file.start}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
