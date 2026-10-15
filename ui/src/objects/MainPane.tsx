// 録音が主役の画面: 右に出すもの。一覧で選んだもの（途中・順番待ち）が先、そのあとは画面の状態（screen）で決める。
// 話者（名前付け）・文字起こし（結果）・処理中・新しい録音・準備の画面の部品を、録音の枠（上の段・下の保存の帯）に入れて出す
import type { ReactNode } from "react";
import { ErrorBand } from "../components/ErrorBand";
import { useT } from "../i18n";
import { basename, dirname, formatMonthDay } from "../lib/format";
import { FileScreen } from "../screens/FileScreen";
import { NamingScreen } from "../screens/NamingScreen";
import { ProcessingScreen } from "../screens/ProcessingScreen";
import { ResultScreen } from "../screens/ResultScreen";
import { DetailModal } from "../screens/result/DetailModal";
import { SaveBar } from "../screens/result/SaveBar";
import { SaveDialog } from "../screens/result/SaveDialog";
import { useTranscriptModel } from "../screens/result/useTranscriptModel";
import { SetupScreen } from "../screens/SetupScreen";
import { closeSaveDialog, openSaveDialog } from "../store/result";
import { getState, useApp } from "../store/state";
import { samePath } from "./model";
import { RecordingHeader, type Tab } from "./RecordingHeader";
import { useCurrentEntry } from "./selection";
import { dequeue, isRunning, resumeUnfinished, retryViewed, saveCurrent, startOrEnqueue, useObjects } from "./store";

/** 「詳細」の窓（話者・文字起こしのどちらのタブからも開く。中身は結果の画面と同じ計算） */
function DetailHost() {
  const { view, talk, stats, colorOf, labelCount } = useTranscriptModel();
  if (!view) return null;
  return <DetailModal talk={talk} stats={stats} labelCount={labelCount} colorOf={colorOf} />;
}

/**
 * 「保存…」の窓（2026-09-29）。元のファイルと同じフォルダは、エンジンが返す既定の保存先（約束 版12）。
 * 元のファイルのフォルダが無い（外付けを外した など）ときエンジンは書類フォルダを返すので、そのときは「元のファイルと同じ」とは書かない
 */
function SaveHost() {
  const open = useApp((s) => s.dialog === "save");
  const sourceDir = useApp((s) => s.job?.outDir ?? "");
  const sourcePath = useApp((s) => s.job?.path ?? "");
  const screens = useApp((s) => s.screens);
  if (!open) return null;
  const sourceGone = Boolean(sourceDir && sourcePath) && !samePath(sourceDir, dirname(sourcePath));
  return (
    <SaveDialog
      sourceDir={sourceDir}
      sourceGone={sourceGone}
      screens={screens}
      onCancel={closeSaveDialog}
      onSave={(dir, formats, zip) => void saveCurrent(dir, formats, zip)}
    />
  );
}

/**
 * 録音の上の段と中身。中身には少なくとも 320px を残し、窓が低くて帯が並んだときは右側全体をスクロールする
 * （最小の窓 900×560 で、元のファイルの帯が出ても名前付け・本文が見えるように）。
 * 「話者」「文字起こし」のどちらでも、下は保存の帯だけ（2026-09-27 決定。名前を付けなくても保存できる）。下に貼り付けて、スクロールしても見える。
 * 帯は「保存…」だけで、形式と保存先は押して開く窓で選ぶ（2026-09-29）
 */
function Recording({ tab, children }: { tab: Tab | null; children: ReactNode }) {
  const entry = useCurrentEntry();
  const saveError = useApp((s) => s.saveError);
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <RecordingHeader entry={entry} tab={tab} />
      <div style={{ flex: "1 0 320px", display: "flex", flexDirection: "column", minHeight: 320 }}>{children}</div>
      {tab ? (
        <div style={{ position: "sticky", bottom: 0, zIndex: 2, flex: "none" }}>
          {saveError ? (
            <div style={{ padding: "10px 32px", borderTop: "1px solid var(--line)", background: "var(--bg-bar)" }}>
              <ErrorBand error={saveError} small />
            </div>
          ) : null}
          <SaveBar onOpen={openSaveDialog} />
        </div>
      ) : null}
      {tab ? <DetailHost /> : null}
      {tab ? <SaveHost /> : null}
    </div>
  );
}

/** 処理中の録音の名前（無ければ null） */
function useRunningName(): string | null {
  const running = useObjects((s) => s.running);
  const meta = useObjects((s) => s.runningMeta);
  return isRunning(running) ? (meta?.name ?? basename(running.path)) : null;
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function QueuedBody({ id }: { id: string }) {
  const t = useT();
  const o = t.objects;
  const item = useObjects((s) => s.queue.find((q) => q.id === id));
  const runningName = useRunningName();
  if (!item) return null;
  return (
    <Page title={o.queuedTitle}>
      <p className="pretty" style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.75 }}>
        {o.queuedBody(runningName ?? "")}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary compact" onClick={() => dequeue(id)}>
          {o.dequeue}
        </button>
      </div>
    </Page>
  );
}

function UnfinishedBody({ jobId }: { jobId: string }) {
  const t = useT();
  const o = t.objects;
  const item = useApp((s) => s.history?.find((h) => h.jobId === jobId));
  const runningName = useRunningName();
  if (!item) return null;
  const sourceOk = item.sourceState === "ok";
  return (
    <Page title={o.stoppedTitle}>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "18px 20px" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{item.diarizationKept ? t.objects.unfinishedDiar : t.objects.unfinishedNone}</span>
        <span className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7 }}>
          {item.diarizationKept ? t.processing.kept : t.processing.notKept}
        </span>
      </div>
      {runningName && sourceOk ? (
        <div className="band-info pretty" style={{ padding: "12px 18px", fontSize: 13, lineHeight: 1.7 }}>
          {o.queueNote(runningName)}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" disabled={!sourceOk} onClick={() => resumeUnfinished(item)}>
          {runningName ? o.enqueue : o.resume}
        </button>
      </div>
    </Page>
  );
}

function Opening() {
  const t = useT();
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--ink-3)" }}>
      {t.objects.opening}
    </div>
  );
}

/** ファイルの画面で選んだファイルが、前に文字起こしした場所のファイルで、そのあと変わっていたとき（約束 版9） */
function ChangedFileNotice() {
  const t = useT();
  const changed = useApp((s) => s.file?.previousChanged ?? null);
  if (!changed) return null;
  const day = formatMonthDay(changed.processedAt) ?? changed.processedAt;
  return (
    <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{t.objects.changedFileTitle}</span>
      <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
        {t.objects.changedFileBody(day)}
      </span>
    </div>
  );
}

function startFromFile(): void {
  const s = getState();
  const f = s.file;
  // 版13: 録画で「マニュアル用に、画面の絵も取り出す」にチェックを入れていれば
  if (f) startOrEnqueue(f.path, { name: f.name, durationSec: f.durationSec, ...(s.screensOn && f.hasVideo ? { screens: true } : {}) });
}

export function MainPane() {
  const booted = useApp((s) => s.booted);
  const screen = useApp((s) => s.screen);
  const peek = useObjects((s) => s.peek);
  const opening = useObjects((s) => s.opening);
  const openError = useObjects((s) => s.openError);
  const runningName = useRunningName();
  const reviewing = useObjects((s) => s.reviewing);

  if (!booted) return null;
  if (peek?.kind === "queued") {
    return (
      <Recording tab={null}>
        <QueuedBody id={peek.id} />
      </Recording>
    );
  }
  if (peek?.kind === "unfinished") {
    return (
      <Recording tab={null}>
        <UnfinishedBody jobId={peek.jobId} />
      </Recording>
    );
  }
  if (opening) {
    return (
      <Recording tab={null}>
        <Opening />
      </Recording>
    );
  }
  if (openError) return <Recording tab={null}>{null}</Recording>;
  switch (screen) {
    case "setup":
      // はじめの準備（AI モデルがそろう前）は ObjectsApp が一覧なしで出す。ここはそろったあとの見返し
      return <SetupScreen variant={reviewing ? "review" : undefined} />;
    case "file":
      return <FileScreen runningName={runningName} start={startFromFile} notice={<ChangedFileNotice />} />;
    case "processing":
      return (
        <Recording tab={null}>
          <ProcessingScreen onRetry={retryViewed} />
        </Recording>
      );
    case "naming":
      return (
        <Recording tab="speakers">
          <NamingScreen />
        </Recording>
      );
    case "result":
      return (
        <Recording tab="transcript">
          <ResultScreen />
        </Recording>
      );
  }
}
