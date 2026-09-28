// 録音が主役の画面（案A。2026-09-27 に製品の画面にした）の状態と操作。
// 右に出す録音は今までどおり画面の状態（store/state の job・screen）が持ち、ここは案A にだけ要るものを持つ:
// 裏で処理している録音（見ていなくても進み具合を追う）・順番待ち・一覧の並び・一覧で選んだ途中の録音など。
// 処理は同時に1本だけ（エンジンの作り）。処理中に足した録音は順番待ちにし、終わったら次を自動で始める（2026-09-27 決定）
import { create } from "zustand";
import type { AppError, HistoryItem, JobDone, JobFailed, JobProgress, SaveFormat } from "@contract/types";
import { api, mockDev } from "../api";
import { getT } from "../i18n";
import { toAppError } from "../lib/errors";
import { basename } from "../lib/format";
import { stopPlayback } from "../lib/player";
import { clearFile, inspectPath } from "../store/file";
import { loadHistory, openHistoryItem, relinkSource } from "../store/history";
import { progressPatch, setCloseInfo, startJob } from "../store/job";
import { startNewRecording } from "../store/leave";
import { applyNamesAndShow, needsApply } from "../store/naming";
import { applySaveChoice, openDetail, save } from "../store/result";
import { loadSetup } from "../store/setup";
import { getState, setState, useApp, type JobView, type Screen } from "../store/state";
import { goTo, showToast } from "../store/ui";
import { mergeOrder, samePath, type Entry, type QueueItem } from "./model";

export interface Meta {
  name: string;
  durationSec: number;
}

/** 一覧で選んでいるが、画面の状態には読み込んでいない録音（途中の録音・順番待ち） */
export type Peek = { kind: "unfinished"; jobId: string } | { kind: "queued"; id: string };

interface ObjectsState {
  /** 処理中の録音（見ていなくても、知らせを受けて進み具合を持つ） */
  running: JobView | null;
  runningMeta: Meta | null;
  queue: QueueItem[];
  peek: Peek | null;
  /** 開いている途中の録音の jobId */
  opening: string | null;
  openError: { jobId: string; error: AppError } | null;
  /** 一覧の並び（jobId）。新しい録音だけ上に足す */
  order: string[];
  /** 狭い窓で一覧を重ねて出している */
  overlay: boolean;
  /** 広い窓で一覧をしまっている */
  collapsed: boolean;
  /** 録音の上に出す帯（保存したファイルが見つからない など） */
  notice: { kind: "savedMissing" | "error"; error: AppError } | null;
  /** 削除する前に確かめている録音 */
  deleting: HistoryItem | null;
  /** 見ていない間に文字起こしが終わり、まだ開いていない録音（一覧の「●」。アプリを閉じても覚えておく） */
  fresh: string[];
  /** 「AI モデルと動作条件」を見返している（はじめの準備とは出し方が違う） */
  reviewing: boolean;
  /** ファイルを窓の上でドラッグしている（窓全体に案内を出す） */
  dragging: boolean;
}

/** 「●」を覚えておく所（開くまで、アプリを閉じても消さない。2026-09-27） */
const FRESH_KEY = "kikiwake.fresh";

function loadFresh(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(FRESH_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveFresh(fresh: string[]): void {
  try {
    window.localStorage.setItem(FRESH_KEY, JSON.stringify(fresh));
  } catch {
    // 覚えておけない所では、この回だけ
  }
}

export const useObjects = create<ObjectsState>(() => ({
  running: null,
  runningMeta: null,
  queue: [],
  peek: null,
  opening: null,
  openError: null,
  order: [],
  overlay: false,
  collapsed: false,
  notice: null,
  deleting: null,
  fresh: loadFresh(),
  reviewing: false,
  dragging: false,
}));

const get = useObjects.getState;
const set = useObjects.setState;

/** 開いている録音で最後にいた画面（設定などから戻るとき） */
let lastRecordingScreen: Screen = "naming";
/** 裏で始めた処理の、startJob が返る前に届いた知らせ */
const early: Array<{ jobId: string; apply: () => void }> = [];
let queueSeq = 0;

export function isRunning(j: JobView | null): j is JobView {
  return Boolean(j && j.status === "running");
}

function sameJob(a: JobView, b: JobView): boolean {
  return a.jobId && b.jobId ? a.jobId === b.jobId : samePath(a.path, b.path);
}

function newJobView(path: string): JobView {
  return {
    jobId: null,
    path,
    outDir: "",
    status: "running",
    stage: "extract",
    percent: 0,
    etaSec: null,
    reused: false,
    startedAt: Date.now(),
    endedAt: null,
    error: null,
    diarizationKept: false,
    cancelRequested: false,
  };
}

// ---- 知らせ（エンジンから） ---------------------------------------------------------------

function onProgress(p: JobProgress): void {
  const r = get().running;
  if (!r) return;
  if (r.jobId === p.jobId) {
    const patch = progressPatch(r, p);
    if (patch) set({ running: { ...r, ...patch } });
  } else if (r.jobId === null && early.length < 200) early.push({ jobId: p.jobId, apply: () => onProgress(p) });
}

function onDone(d: JobDone): void {
  const r = get().running;
  if (!r) return;
  if (r.jobId === d.jobId) void finishRunning(d.jobId, "done", true);
  else if (r.jobId === null) early.push({ jobId: d.jobId, apply: () => onDone(d) });
}

function onFailed(f: JobFailed): void {
  const r = get().running;
  if (!r) return;
  if (r.jobId === f.jobId) void finishRunning(f.jobId, f.error.code === "cancelled" ? "cancelled" : "failed", f.diarizationKept);
  else if (r.jobId === null) early.push({ jobId: f.jobId, apply: () => onFailed(f) });
}

/**
 * 処理が終わった・止まった: 順番待ちの次をすぐに始め（一覧を読み直している間に閉じると、エンジンが処理中でないので
 * 確かめずに閉じ、順番待ちが消えるため）、一覧を読み直し、見ていなければ知らせる
 */
async function finishRunning(jobId: string, how: "done" | "failed" | "cancelled", diarizationKept: boolean): Promise<void> {
  const r = get().running;
  const meta = get().runningMeta;
  const name = meta?.name ?? basename(r?.path ?? "");
  const viewed = getState().job?.jobId === jobId;
  if (r) keepRow(jobId, r.path, meta, how === "done" ? "done" : "unfinished", diarizationKept);
  set({ running: null, runningMeta: null, ...(how === "done" && !viewed ? { fresh: [...get().fresh.filter((id) => id !== jobId), jobId] } : {}) });
  void startNext();
  await loadHistory();
  const t = getT().objects;
  if (!viewed && how !== "cancelled") showToast(how === "done" ? t.doneToast(name) : t.failedToast(name));
}

/**
 * 一覧を読み直すまでの仮の行（終わった録音が一覧から一瞬消えて現れるのを避ける）。読み直すとエンジンの値に替わる。
 * 話者の数・名前・保存したかは、読み直すまで出さない
 */
function keepRow(jobId: string, path: string, meta: Meta | null, status: HistoryItem["status"], diarizationKept: boolean): void {
  const history = getState().history;
  if (!history || history.some((h) => h.jobId === jobId)) return;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const item: HistoryItem = {
    jobId,
    name: meta?.name ?? basename(path),
    path,
    durationSec: meta?.durationSec ?? 0,
    processedAt: today,
    status,
    named: false,
    unsavedEdits: false,
    sourceAvailable: true,
    diarizationKept: status === "done" || diarizationKept,
    sourceState: "ok",
    saved: false,
  };
  setState({ history: [item, ...history] });
}

/** 順番待ちの先頭を始める。見ていた順番待ちなら、その進み具合を見せる */
async function startNext(): Promise<void> {
  const { running, queue, peek } = get();
  if (isRunning(running) || !queue.length) return;
  const [next, ...rest] = queue;
  const viewing = peek?.kind === "queued" && peek.id === next.id;
  set({ queue: rest, runningMeta: { name: next.name, durationSec: next.durationSec } });
  if (viewing) {
    set({ peek: null });
    setState({ playable: true, relinkError: null, file: null });
    void startJob(next.path);
    return;
  }
  const job = newJobView(next.path);
  early.length = 0;
  set({ running: job });
  try {
    const started = await api.startJob({ path: next.path });
    const r = get().running;
    if (r !== job && !(r && r.jobId === null && samePath(r.path, next.path))) return;
    set({ running: { ...(r ?? job), jobId: started.jobId, outDir: started.outDir } });
    // 返る前に一覧で選んで見ていたら、画面の側の録音にも ID を入れる（以後は画面の側も知らせで進む）
    const viewed = getState().job;
    if (viewed && viewed.jobId === null && isRunning(viewed) && samePath(viewed.path, next.path)) {
      setState({ job: { ...viewed, jobId: started.jobId, outDir: started.outDir } });
    }
    early.splice(0).filter((e) => e.jobId === started.jobId).forEach((e) => e.apply());
  } catch (e) {
    set({ running: null, runningMeta: null });
    showToast(getT().objects.startFailed(next.name, getT().engine.error(toAppError(e))));
    void startNext();
  }
}

// ---- 始める・順番待ち ---------------------------------------------------------------------

/** 始める。処理中なら順番待ちに入れる（2026-09-27 決定） */
export function startOrEnqueue(path: string, meta: Meta): void {
  if (isRunning(get().running)) {
    enqueue(path, meta);
    return;
  }
  set({ peek: null, runningMeta: meta, notice: null });
  setState({ playable: true, relinkError: null });
  void startJob(path);
}

export function enqueue(path: string, meta: Meta, select = true): void {
  const { running, queue } = get();
  const t = getT().objects;
  if ((running && isRunning(running) && samePath(running.path, path)) || queue.some((q) => samePath(q.path, path))) {
    showToast(t.alreadyQueued);
    return;
  }
  const id = `q${++queueSeq}`;
  set({ queue: [...queue, { id, path, ...meta }], ...(select ? { peek: { kind: "queued" as const, id } } : {}) });
  clearFile();
  showToast(t.queuedToast);
}

export function dequeue(id: string): void {
  const { queue, peek } = get();
  set({ queue: queue.filter((q) => q.id !== id) });
  if (peek?.kind === "queued" && peek.id === id) selectNew();
}

// ---- 一覧で選ぶ ---------------------------------------------------------------------------

function closeOverlay(): void {
  if (get().overlay) set({ overlay: false });
}

/** 「＋ 新しい録音」 */
export function selectNew(): void {
  closeOverlay();
  set({ peek: null, openError: null, notice: null });
  const s = getState();
  if (s.screen === "file" && !s.job) return;
  startNewRecording();
}

/** 「AI モデルと動作条件」（そろったあとに見返す。はじめの準備と違い、一覧を出したまま右に出す） */
export async function selectSettings(): Promise<void> {
  closeOverlay();
  set({ peek: null, openError: null, notice: null, reviewing: true });
  await loadSetup();
  goTo("setup");
}

export async function selectEntry(e: Entry): Promise<void> {
  closeOverlay();
  set({ openError: null, notice: null });
  const s = getState();
  if (e.kind === "queued") {
    set({ peek: { kind: "queued", id: e.item.id } });
    return;
  }
  if (e.kind === "running") {
    set({ peek: null });
    const r = get().running;
    if (!r) return;
    if (isRunning(s.job) && sameJob(s.job, r)) {
      goTo("processing");
      return;
    }
    stopPlayback();
    setState({ job: { ...r }, file: null, dialog: null, playable: true, relinkError: null });
    goTo("processing");
    return;
  }
  const item = e.item;
  if (item.status === "unfinished") {
    set({ peek: { kind: "unfinished", jobId: item.jobId } });
    return;
  }
  set({ peek: null });
  // もう開いている（設定・新しい録音の画面から戻る）
  if (s.job?.jobId === item.jobId && s.job.status === "done" && (s.speakers.length > 0 || s.view)) {
    goTo(s.screen === "naming" || s.screen === "result" ? s.screen : lastRecordingScreen);
    return;
  }
  set({ opening: item.jobId });
  await openHistoryItem(item);
  const err = getState().historyError;
  set({ opening: null, openError: err ? { jobId: item.jobId, error: err } : null });
  if (err) setState({ historyError: null });
}

/** 途中の録音の「続きから処理する」（処理中なら順番待ち） */
export function resumeUnfinished(item: HistoryItem): void {
  startOrEnqueue(item.path, { name: item.name, durationSec: item.durationSec });
}

/** 処理の画面の「やり直す」（処理中の録音がほかにあれば順番待ち） */
export function retryViewed(): void {
  const s = getState();
  const j = s.job;
  if (!j) return;
  const item = s.history?.find((h) => h.jobId === j.jobId);
  startOrEnqueue(j.path, item ? { name: item.name, durationSec: item.durationSec } : { name: basename(j.path), durationSec: 0 });
}

// ---- 録音に対する操作 ----------------------------------------------------------------------

/** 一覧の行の「…」の「削除…」: 確かめてから削除する（作業フォルダを丸ごと。元の録音と保存したファイルは削除しない） */
export function deleteEntry(item: HistoryItem): void {
  set({ deleting: item });
}

export function cancelDelete(): void {
  set({ deleting: null });
}

export async function confirmDelete(): Promise<void> {
  const item = get().deleting;
  set({ deleting: null });
  if (!item) return;
  try {
    await api.deleteHistory(item.jobId);
    showToast(getT().objects.deletedToast);
  } catch (e) {
    set({ notice: { kind: "error", error: toAppError(e) } });
    return;
  }
  const s = getState();
  const peek = get().peek;
  if (peek?.kind === "unfinished" && peek.jobId === item.jobId) set({ peek: null });
  // 開いていた録音を消したら、新しい録音の画面へ
  if (s.job?.jobId === item.jobId || (peek?.kind === "unfinished" && peek.jobId === item.jobId)) startNewRecording();
  await loadHistory();
}

/**
 * 保存（「話者」「文字起こし」のどちらのタブの下からでも）。「保存…」の窓で選んだ保存先と形式で（2026-09-29）、
 * 入れた名前がまだ確定していなければ、確定してから保存する。名前を付けていなければ「話者A」などのまま保存する（2026-09-27 決定）
 */
export async function saveCurrent(dir: string, formats: SaveFormat[]): Promise<void> {
  applySaveChoice(dir, formats);
  if (needsApply(getState()) && !(await applyNamesAndShow(false))) return;
  await save();
}

/** 「詳細」（話者・文字起こしのどちらのタブからも。2026-09-27）。入れた名前がまだ確定していなければ、確定してから開く（発言時間は名前でまとめて数えるため） */
export async function openDetails(): Promise<void> {
  if (needsApply(getState()) && !(await applyNamesAndShow(false))) return;
  openDetail();
}

/** 元のファイルを選び直す（Mac のファイル選択の画面で） */
export async function relinkPick(): Promise<void> {
  await relinked(() => relinkSource());
}

/** 元のファイルが変わったとき、同じ場所のファイルで結び直す（長さが同じなら結び直せる） */
export async function relinkSamePath(path: string): Promise<void> {
  await relinked(() => relinkSource(path));
}

/** 結び直すと録音の ID が変わるので、一覧の並びの場所を引き継ぐ（新しい録音として一番上に動かない） */
async function relinked(relink: () => Promise<void>): Promise<void> {
  const before = getState().job?.jobId;
  await relink();
  const after = getState().job?.jobId;
  if (before && after && before !== after) set({ order: get().order.map((id) => (id === before ? after : id)) });
  await loadHistory();
}

/** 変わったファイルを、新しい録音として文字起こしする（前の文字起こしは一覧に残る） */
export async function retranscribe(path: string): Promise<void> {
  set({ peek: null, notice: null });
  startNewRecording();
  await inspectPath(path);
}

function isOpen(item: HistoryItem): boolean {
  const j = getState().job;
  return j?.jobId === item.jobId && j.status === "done";
}

/** その録音で最後に保存したファイル（開いている録音は画面の値、ほかはエンジンの一覧の値。約束 版12）。保存していなければ空 */
export function savedFilesOf(item: HistoryItem): string[] {
  const live = isOpen(item) ? getState().lastSaved : [];
  return live.length ? live : (item.savedFiles ?? []);
}

/**
 * 一覧の行の「…」の「Finder で表示」（2026-09-29 決定: 保存の帯から一覧の行へ移した）。その録音で最後に保存したファイルを Finder で選んで見せる。
 * 見つからなければ（移した・消した）その録音を開き、上に帯を出す（もう一度保存すると作り直せる）
 */
export async function revealSavedOf(entry: Extract<Entry, { kind: "history" }>): Promise<void> {
  const file = savedFilesOf(entry.item)[0];
  if (!file) return;
  try {
    await api.revealInFileManager(file);
    if (get().notice?.kind === "savedMissing") set({ notice: null });
  } catch (e) {
    const error = toAppError(e);
    if (!isOpen(entry.item)) await selectEntry(entry);
    if (isOpen(entry.item)) set({ notice: { kind: "savedMissing", error } });
  }
}

export function dismissNotice(): void {
  set({ notice: null });
}

export function toggleCollapsed(): void {
  set({ collapsed: !get().collapsed });
}

export function setOverlay(overlay: boolean): void {
  set({ overlay });
}

function setDragging(dragging: boolean): void {
  if (get().dragging !== dragging) set({ dragging });
}

/** ファイルのドラッグを見張る。ブラウザの見本は HTML5 の知らせ、アプリの中は外枠の知らせ（約束 版6 の onFileDragOver） */
function watchDrag(): () => void {
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const over = (e: DragEvent) => {
    if (hasFiles(e)) setDragging(true);
  };
  const leave = (e: DragEvent) => {
    // 窓の外へ出たときだけ（中の部品の間を動くときにも dragleave は来る）
    if (e.relatedTarget === null) setDragging(false);
  };
  const end = () => setDragging(false);
  window.addEventListener("dragenter", over);
  window.addEventListener("dragover", over);
  window.addEventListener("dragleave", leave);
  window.addEventListener("drop", end);
  const off = api.onFileDragOver((e) => setDragging(e.over));
  return () => {
    window.removeEventListener("dragenter", over);
    window.removeEventListener("dragover", over);
    window.removeEventListener("dragleave", leave);
    window.removeEventListener("drop", end);
    off();
  };
}

// ---- 始まりと終わり -----------------------------------------------------------------------

/** 案A を出している間だけ動かす（知らせを受け、画面の状態を見張る）。返り値で止める */
export function startObjects(): () => void {
  const offs = [api.onJobProgress(onProgress), api.onJobDone(onDone), api.onJobFailed(onFailed), api.onFileDrop(onDropAnywhere), watchDrag()];
  // 処理中に閉じるときの確かめ: 見ていない処理中の録音でも出し、順番待ちの数も書く（2026-09-27 決定）
  setCloseInfo(() => {
    const { running, runningMeta, queue } = get();
    if (!isRunning(running)) return null;
    return { name: runningMeta?.name ?? basename(running.path), stage: running.stage, reused: running.reused, queued: queue.length };
  });
  const offFresh = useObjects.subscribe((o, p) => {
    if (o.fresh !== p.fresh) saveFresh(o.fresh);
  });
  // 画面で始めた処理（ファイルの画面・続きから・やり直す）を、処理中の録音として持つ
  const unsub = useApp.subscribe((s, p) => {
    if (s.job !== p.job && isRunning(s.job)) {
      const o = get();
      const meta =
        o.runningMeta && o.running && samePath(o.running.path, s.job.path)
          ? o.runningMeta
          : s.file && samePath(s.file.path, s.job.path)
            ? { name: s.file.name, durationSec: s.file.durationSec }
            : (o.runningMeta ?? { name: basename(s.job.path), durationSec: 0 });
      set({ running: s.job, runningMeta: meta });
      // 画面の側で ID が決まったら、それまでにこちらで預かった知らせを当てる（終わりの知らせを取りこぼさない）
      const id = s.job.jobId;
      if (id) early.splice(0).filter((e) => e.jobId === id).forEach((e) => e.apply());
    }
    if (s.screen !== p.screen && (s.screen === "naming" || s.screen === "result")) lastRecordingScreen = s.screen;
    // 見返しの画面から離れた
    if (p.screen === "setup" && s.screen !== "setup" && get().reviewing) set({ reviewing: false });
    // 開いた録音の「●」を消す
    const openId = s.job?.status === "done" ? s.job.jobId : null;
    if (openId && get().fresh.includes(openId)) set({ fresh: get().fresh.filter((id) => id !== openId) });
    // 開いていた録音から離れた: その録音の状態（手直し・保存）を一覧に出すため、閉じたときの状態を書き終えたころに読み直す
    if (p.job?.status === "done" && s.job?.jobId !== p.job.jobId) window.setTimeout(() => void loadHistory(), 400);
    if (s.history !== p.history && s.history) onHistory(s.history);
  });
  // 始まる前に画面の側で処理を始めていた録音があれば引き継ぐ
  const s = getState();
  if (isRunning(s.job) && !isRunning(get().running)) {
    const meta = s.file && samePath(s.file.path, s.job.path) ? { name: s.file.name, durationSec: s.file.durationSec } : { name: basename(s.job.path), durationSec: 0 };
    set({ running: s.job, runningMeta: meta });
  }
  void loadHistory();
  return () => {
    offs.forEach((off) => off());
    offFresh();
    unsub();
    setCloseInfo(null);
  };
}

/**
 * どの画面でも、ファイルを窓に落とせば新しい録音として受ける（前の形は「録音を選ぶ」の画面でだけ受けた）。
 * 新しい録音の画面では今までどおり store/file の onFileDrop が受ける
 */
function onDropAnywhere(paths: string[]): void {
  if (!paths.length || getState().screen === "file" || getState().screen === "setup") return;
  set({ peek: null, openError: null, notice: null });
  closeOverlay();
  startNewRecording();
  void inspectPath(paths[0]);
}

function onHistory(history: HistoryItem[]): void {
  // 「●」は一覧に無くなった録音（消した・選び直して ID が変わった）のぶんを捨てる
  const fresh = get().fresh.filter((id) => history.some((h) => h.jobId === id));
  set({ order: mergeOrder(get().order, history), ...(fresh.length !== get().fresh.length ? { fresh } : {}) });
  // 一覧で選んでいた途中の録音が無くなった（続きから始めて処理中の行になった）
  const peek = get().peek;
  if (peek?.kind === "unfinished" && !history.some((h) => h.jobId === peek.jobId)) set({ peek: null });
}

/** 見本の作例: 処理中の録音と順番待ち2件をすぐに作る */
export async function demoQueue(paths: string[]): Promise<void> {
  const infos = await Promise.all(paths.map((p) => api.inspectFile(p)));
  const [first, ...rest] = infos;
  if (!first) return;
  if (!isRunning(get().running)) startOrEnqueue(first.path, { name: first.name, durationSec: first.durationSec });
  else enqueue(first.path, { name: first.name, durationSec: first.durationSec }, false);
  rest.forEach((f) => enqueue(f.path, { name: f.name, durationSec: f.durationSec }, false));
}


/** 見本の作例: 開いている録音（または一覧で選んだ途中の録音）の元のファイルの状態を変える */
export async function devSetSource(state: "ok" | "missing" | "changed-same" | "changed-diff"): Promise<void> {
  if (!mockDev) return;
  const s = getState();
  const peek = get().peek;
  const jobId = peek?.kind === "unfinished" ? peek.jobId : s.job?.status === "done" ? s.job.jobId : null;
  if (!jobId) return;
  mockDev.setSourceState(jobId, state);
  if (s.job?.jobId === jobId) setState({ playable: state === "ok", relinkError: null });
  await loadHistory();
}
