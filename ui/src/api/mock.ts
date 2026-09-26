// 受け渡しの約束（contract/api.ts の KikiwakeApi）の見本実装。contract/fixtures を返す。
// 開発サーバのときだけ読み込まれる（製品のビルドには入らない）。作例の切替は mockDev から行う（開発用の切替パネル）。
import type { KikiwakeApi, Unsubscribe } from "@contract/api";
import type {
  EnvironmentCheck,
  FileInfo,
  JobDone,
  JobFailed,
  JobProgress,
  ModelInfo,
  Names,
  SaveResult,
  SpeakerCard,
  TalkTime,
  TranscriptView,
  AppError,
} from "@contract/types";
import {
  EXAMPLE_DURATION_SEC,
  LARGE_DEMO_NAMES,
  fixtureError,
  fixtures,
  largeData,
  progressTimeline,
  sampleUrl,
  silentWavUrl,
  type TimelineEvent,
} from "./mockData";

// ---- 作例 ---------------------------------------------------------------------------

export interface MockScenario {
  os: "mac" | "windows";
  data: "sample" | "large";
  setup: "normal" | "warn" | "block" | "partial" | "failed" | "ready";
  file: "normal" | "unsupported" | "previous";
  job: "normal" | "failed";
  speed: 60 | 600;
  naming: "normal" | "warnings";
  result: "one" | "typical" | "none" | "repeat";
  save: "normal" | "existing" | "failed";
  applyFails: boolean;
}

export const DEFAULT_SCENARIO: MockScenario = {
  os: "mac",
  data: "sample",
  setup: "normal",
  file: "normal",
  job: "normal",
  speed: 60,
  naming: "normal",
  result: "one",
  save: "normal",
  applyFails: false,
};

let scenario: MockScenario = { ...DEFAULT_SCENARIO };

/** 見本だけの知らせ（Finder で表示・アプリを閉じる など、製品では OS が行うこと） */
export interface MockNotice {
  kind: "text" | "closed";
  text: string;
}

function emitter<T>() {
  const set = new Set<(v: T) => void>();
  return {
    on(cb: (v: T) => void): Unsubscribe {
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    emit(v: T) {
      set.forEach((cb) => cb(v));
    },
  };
}

const ev = {
  model: emitter<ModelInfo>(),
  drop: emitter<string[]>(),
  progress: emitter<JobProgress>(),
  done: emitter<JobDone>(),
  failed: emitter<JobFailed>(),
  close: emitter<void>(),
  scenario: emitter<MockScenario>(),
  notice: emitter<MockNotice>(),
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- パス（見本の OS に合わせる） --------------------------------------------------------

function osPath(p: string): string {
  if (scenario.os !== "windows" || /^[A-Za-z]:\\/.test(p)) return p;
  if (p.startsWith("/Users/")) return "C:\\Users\\" + p.slice("/Users/".length).split("/").join("\\");
  return p.split("/").join("\\");
}

const pathKey = (p: string) => p.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/").replace(/\/+$/, "");
const sep = () => (scenario.os === "windows" ? "\\" : "/");
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const stemOf = (name: string) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

function joinPath(dir: string, name: string): string {
  return /[\\/]$/.test(dir) ? dir + name : dir + sep() + name;
}

function outDirFor(path: string): string {
  return joinPath(dirOf(path), `${stemOf(baseName(path))}_文字起こし`);
}

// ---- 画面1 初回セットアップ --------------------------------------------------------------

function environment(): EnvironmentCheck {
  const env = scenario.os === "windows" ? fixtures.envWindows() : fixtures.envMac();
  if (scenario.setup === "warn") {
    env.freeDiskGB = 9.6;
    const disk = env.checks.find((c) => c.id === "disk");
    if (disk) {
      disk.level = "warn";
      disk.message = "今は足ります。長い録音を続けて処理すると足りなくなることがあります。";
    }
  }
  if (scenario.setup === "block") {
    const p = fixtures.envProblem();
    env.memoryGB = p.memoryGB;
    env.freeDiskGB = p.freeDiskGB;
    env.checks = p.checks;
    env.canRun = p.canRun;
    if (scenario.os === "mac") {
      env.osVersion = p.osVersion;
      env.cpu = p.cpu;
      env.gpu = p.gpu;
    }
  }
  return env;
}

function initialModels(): ModelInfo[] {
  const list = fixtures.modelsInitial();
  const whisper = list.find((m) => m.id === "whisper-large-v3");
  const diar = list.find((m) => m.id === "nemotron-3-diarization");
  const ready = (m?: ModelInfo) => {
    if (m) {
      m.state = "ready";
      m.downloadedBytes = m.sizeBytes;
    }
  };
  if (scenario.setup === "partial" && whisper) {
    ready(diar);
    whisper.state = "partial";
    whisper.downloadedBytes = fixtures.modelsDownloading().find((m) => m.id === whisper.id)?.downloadedBytes ?? 0;
  }
  if (scenario.setup === "failed" && whisper) {
    ready(diar);
    whisper.state = "error";
    whisper.downloadedBytes = 1_150_234_112;
    whisper.error = fixtureError(
      "network_unreachable",
      "ModelDownloadError code=network_unreachable\nmodel=whisper-large-v3\nreceived=1150234112/3095033483 bytes\n" +
        "error sending request for url (https://huggingface.co/…): dns error: failed to lookup address information",
    );
  }
  if (scenario.setup === "ready") list.forEach(ready);
  return list;
}

let models: ModelInfo[] = initialModels();
let downloadToken = 0;
const DOWNLOAD_BYTES_PER_SEC = 180_000_000;

function emitModel(m: ModelInfo) {
  ev.model.emit(structuredClone(m));
}

// ---- 画面2 ファイル選択 -----------------------------------------------------------------

const SUPPORTED = new Set(["mp4", "mov", "m4a", "mp3", "wav"]);

/** 対応している形式のときの元になる情報 */
function supportedBase(): FileInfo {
  if (scenario.data === "large") return largeData().file;
  if (scenario.file === "previous") return fixtures.file68();
  return fixtures.file();
}

/** 「ファイルを選ぶ」で選ばれる見本のファイル */
function scenarioFilePath(): string {
  if (scenario.file === "unsupported") return osPath(fixtures.fileUnsupported().path);
  return osPath(supportedBase().path);
}

/** 話者の判定まで済んだ録音（やり直すと使い回す） */
const diarizationDone = new Set<string>();

/** 版6: 書き起こしまで済んだ録音（選び直すと、書き起こしをやり直さずに1秒ほどで名前付けへ）と、そのとき確定した名前 */
const transcriptDone = new Set<string>();
const namesByPath = new Map<string, Names>();

let dropAttached = false;

function attachDrop() {
  if (dropAttached) return;
  dropAttached = true;
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  // ブラウザの見本では、HTML5 の drop を onFileDrop に見立てる（Tauri では外枠がパスを知らせる）
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    const dir = osPath("/Users/example/Movies");
    ev.drop.emit(files.map((f) => joinPath(dir, f.name)));
  });
}

// ---- 画面3 処理中 ------------------------------------------------------------------

interface MockJob {
  id: string;
  path: string;
  timers: number[];
  running: boolean;
  diarizationKept: boolean;
}

let jobSeq = 0;
let job: MockJob | null = null;

function stopTimers(j: MockJob | null) {
  j?.timers.forEach((t) => clearTimeout(t));
  if (j) j.timers = [];
}

function fail(j: MockJob, error: AppError) {
  j.running = false;
  stopTimers(j);
  ev.failed.emit({ jobId: j.id, error, diarizationKept: j.diarizationKept });
}

function jobDone(j: MockJob) {
  j.running = false;
  stopTimers(j);
  transcriptDone.add(pathKey(j.path));
  const t = baseTranscript();
  const names = namesByPath.get(pathKey(j.path));
  ev.done.emit({
    jobId: j.id,
    outDir: outDirFor(j.path),
    speakers: speakersFor().length,
    unresolvedCount: t.unresolved.length,
    ...(names && Object.keys(names).length ? { names: { ...names } } : {}),
  });
}

function deliver(j: MockJob, e: TimelineEvent) {
  if (job !== j || !j.running) return;
  if (e.event === "done") {
    jobDone(j);
    return;
  }
  const p: JobProgress = { ...e.data, jobId: j.id };
  if (p.stage === "transcribe" || p.stage === "merge") {
    j.diarizationKept = true;
    diarizationDone.add(pathKey(j.path));
  }
  if (scenario.job === "failed" && p.stage === "transcribe" && (p.stagePercent ?? 0) > 63) {
    ev.progress.emit({ ...p, stagePercent: 63 });
    fail(
      j,
      fixtureError(
        "disk_full",
        "JobFailed stage=transcribe code=disk_full\nwrite chunk_0412.wav: No space left on device (os error 28)\n（見本の作例）",
      ),
    );
    return;
  }
  ev.progress.emit(p);
}

// ---- 画面4・5 ----------------------------------------------------------------------

function speakersFor(): SpeakerCard[] {
  if (scenario.data === "large") return largeData().speakers;
  return scenario.naming === "warnings" ? fixtures.speakersWarnings() : fixtures.speakers();
}

function baseTranscript(): TranscriptView {
  let t: TranscriptView;
  if (scenario.data === "large") t = largeData().transcript;
  else if (scenario.result === "typical") t = fixtures.transcriptUnresolved();
  else if (scenario.result === "repeat") t = fixtures.transcriptRepeat();
  else t = fixtures.transcript();
  if (scenario.result === "none") t.unresolved = [];
  if (scenario.data === "large" && scenario.result === "repeat") {
    t.repeats = [
      {
        startSec: 5400,
        endSec: 6600,
        speechSec: 1104.2,
        message: "1:30:00〜1:50:00 の書き起こしは、同じ文の繰り返しになっていて読めません",
      },
    ];
  }
  t.source = osPath(t.source);
  return t;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** 見本のエンジンの名前付け: 行はまとめず、speaker に名前を当て、発言時間は名前でまとめる */
function applyNamesTo(t: TranscriptView, names: Names): TranscriptView {
  const nameOf = (label: string) => (names[label] ?? "").trim() || label;
  t.utterances = t.utterances.map((u) => ({ ...u, speaker: nameOf(u.label) }));
  const merged = new Map<string, TalkTime>();
  for (const tt of t.talkTime) {
    const n = nameOf(tt.speaker);
    const m = merged.get(n);
    if (m) {
      m.sec += tt.sec;
      m.share += tt.share;
    } else merged.set(n, { speaker: n, sec: tt.sec, share: tt.share });
  }
  t.talkTime = [...merged.values()]
    .map((x) => ({ speaker: x.speaker, sec: round(x.sec, 2), share: round(x.share, 4) }))
    .sort((a, b) => b.sec - a.sec);
  t.named = Object.values(names).some((v) => v.trim());
  return t;
}

const appliedNames = new Map<string, Names>();
const savedFiles = new Set<string>();
/** 版6: 画面が知らせた「保存していない手直しがある」 */
let unsavedChanges = false;

// ---- KikiwakeApi ------------------------------------------------------------------

export const mockApi: KikiwakeApi = {
  async checkEnvironment() {
    await wait(120);
    return environment();
  },
  async getModels() {
    await wait(80);
    return structuredClone(models);
  },
  async downloadModels(ids) {
    const my = ++downloadToken;
    for (const id of ids) {
      const m = models.find((x) => x.id === id);
      if (!m || m.state === "ready") continue;
      m.state = "downloading";
      delete m.error;
      emitModel(m);
      while (m.downloadedBytes < m.sizeBytes) {
        await wait(100);
        if (my !== downloadToken) return;
        m.downloadedBytes = Math.min(m.sizeBytes, m.downloadedBytes + DOWNLOAD_BYTES_PER_SEC * 0.1);
        emitModel(m);
      }
      m.state = "verifying";
      emitModel(m);
      await wait(1400);
      if (my !== downloadToken) return;
      m.state = "ready";
      emitModel(m);
    }
  },
  async cancelDownload() {
    downloadToken++;
    for (const m of models) {
      if (m.state === "downloading" || m.state === "verifying") {
        m.state = "partial";
        emitModel(m);
      }
    }
  },
  onModelProgress: (cb) => ev.model.on(cb),

  async pickMediaFile() {
    await wait(150);
    return scenarioFilePath();
  },
  onFileDrop(cb) {
    attachDrop();
    return ev.drop.on(cb);
  },
  // 版6: 見本（ブラウザ）では HTML5 のドラッグの知らせで枠の色が変わるので、ここからは何も送らない
  onFileDragOver: () => () => {},
  async inspectFile(path) {
    await wait(200);
    const name = baseName(path);
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!SUPPORTED.has(ext)) {
      return { ...fixtures.fileUnsupported(), name, path };
    }
    const base = supportedBase();
    const info: FileInfo = { ...base, name, path };
    const reusable = scenario.file === "previous" || diarizationDone.has(pathKey(path));
    const resultReusable = transcriptDone.has(pathKey(path));
    if (reusable) {
      info.previous = {
        outDir: outDirFor(path),
        diarizationReusable: true,
        processedAt: base.previous?.processedAt ?? new Date().toISOString().slice(0, 10),
        resultReusable,
      };
      // 版6: 前回の書き起こしを使い回すときは数秒（エンジンと同じ）
      if (resultReusable) info.estimate = { minSec: 1, maxSec: 10 };
    } else delete info.previous;
    return info;
  },

  async startJob({ path }) {
    await wait(120);
    if (job) {
      job.running = false;
      stopTimers(job);
    }
    const reused = scenario.file === "previous" || diarizationDone.has(pathKey(path));
    const j: MockJob = { id: `job-mock-${++jobSeq}`, path, timers: [], running: true, diarizationKept: reused };
    job = j;
    if (transcriptDone.has(pathKey(path))) {
      // 版6: 前回の書き起こしを使い回す（エンジンは1秒ほど。段階は一瞬で進む）
      const at = (sec: number, stage: JobProgress["stage"], stagePercent: number | null) =>
        j.timers.push(
          window.setTimeout(
            () => deliver(j, { atSec: sec, event: "progress", data: { jobId: j.id, stage, stagePercent, etaSec: null, elapsedSec: 0, reusedDiarization: true } }),
            sec * 1000,
          ),
        );
      at(0.1, "extract", null);
      at(0.3, "diarize", null);
      at(0.5, "transcribe", 100);
      at(0.8, "merge", null);
      j.timers.push(window.setTimeout(() => job === j && j.running && jobDone(j), 1100));
      return { jobId: j.id, outDir: outDirFor(path) };
    }
    const scale = scenario.data === "large" ? largeData().file.durationSec / EXAMPLE_DURATION_SEC : 1;
    const speed = scenario.speed;
    for (const e of progressTimeline(scale, reused)) {
      j.timers.push(window.setTimeout(() => deliver(j, e), (e.atSec / speed) * 1000));
    }
    return { jobId: j.id, outDir: outDirFor(path) };
  },
  async cancelJob(jobId) {
    await wait(150);
    if (job && job.id === jobId && job.running) fail(job, fixtureError("cancelled"));
  },
  onJobProgress: (cb) => ev.progress.on(cb),
  onJobDone: (cb) => ev.done.on(cb),
  onJobFailed: (cb) => ev.failed.on(cb),

  async getSpeakers() {
    await wait(150);
    return speakersFor();
  },
  async getUnresolvedHints() {
    await wait(80);
    return scenario.result === "none" ? [] : fixtures.hints();
  },
  audioSrc: (audioPath) => sampleUrl(audioPath),
  async applyNames(jobId, names) {
    await wait(450);
    if (scenario.applyFails) {
      throw fixtureError("engine_failed", "apply_names: transcript_named.json を書けませんでした（見本の作例）");
    }
    appliedNames.set(jobId, { ...names });
    if (job && job.id === jobId) namesByPath.set(pathKey(job.path), { ...names });
    return applyNamesTo(baseTranscript(), names);
  },

  async getTranscript(jobId, named) {
    await wait(100);
    const t = baseTranscript();
    return named ? applyNamesTo(t, appliedNames.get(jobId) ?? {}) : t;
  },
  async pickFolder(defaultDir) {
    await wait(200);
    // 見本: 既定の保存先とデスクトップの間で切り替える（製品では OS のフォルダ選択画面）
    const path = job?.path ?? scenarioFilePath();
    const original = outDirFor(path);
    const desktop = joinPath(osPath("/Users/example/Desktop"), `${stemOf(baseName(path))}_文字起こし`);
    return defaultDir && pathKey(defaultDir) === pathKey(desktop) ? original : desktop;
  },
  async saveOutputs(jobId, req): Promise<SaveResult> {
    await wait(600);
    if (scenario.save === "failed") {
      throw fixtureError("disk_full", "save_outputs: No space left on device (os error 28)\n（見本の作例）");
    }
    const named =
      Object.values(appliedNames.get(jobId) ?? {}).some((v) => v.trim()) ||
      Object.values(req.edits?.names ?? {}).some((v) => v.trim());
    const base = named ? "transcript_named" : "transcript";
    const files = req.formats.map((f) => joinPath(req.dir, `${base}.${f}`));
    const existing = files.filter((f) => scenario.save === "existing" || savedFiles.has(pathKey(f)));
    if (existing.length && !req.overwrite) return { files: [], existing };
    files.forEach((f) => savedFiles.add(pathKey(f)));
    return { files };
  },
  async recordingSrc(_jobId, startSec, endSec) {
    await wait(30);
    return silentWavUrl(endSec - startSec);
  },
  async revealInFileManager(path) {
    await wait(50);
    const where = scenario.os === "windows" ? "エクスプローラー" : "Finder";
    ev.notice.emit({ kind: "text", text: `（見本）${where}で表示：${path}` });
  },

  onCloseRequested: (cb) => ev.close.on(() => cb()),
  // 版6: 保存していない手直しがあるか（見本では覚えておき、閉じる操作をまねるときに使う）
  async setUnsavedChanges(unsaved) {
    unsavedChanges = unsaved;
  },
  async closeApp() {
    await wait(50);
    if (job) {
      job.running = false;
      stopTimers(job);
    }
    ev.notice.emit({ kind: "closed", text: "（見本）ここでアプリが閉じます" });
  },
};

// ---- 開発用の切替（見本だけ） --------------------------------------------------------------

export const mockDev = {
  scenario: (): MockScenario => scenario,
  setScenario(patch: Partial<MockScenario>) {
    scenario = { ...scenario, ...patch };
    if ("setup" in patch) {
      downloadToken++;
      models = initialModels();
    }
    ev.scenario.emit(scenario);
  },
  onScenario: (cb: (s: MockScenario) => void) => ev.scenario.on(cb),
  onNotice: (cb: (n: MockNotice) => void) => ev.notice.on(cb),
  /** 「ファイルを選ぶ」で選ばれるファイル */
  scenarioFilePath,
  /** 処理を始められるファイル（非対応の作例でも、画面3〜5へ直接移るときに使う） */
  runnableFilePath: () => osPath(supportedBase().path),
  /** 処理中のジョブをすぐに終える（画面4・5へ直接移るとき） */
  finishJobNow(jobId: string) {
    if (!job || job.id !== jobId || !job.running) return;
    stopTimers(job);
    job.diarizationKept = true;
    diarizationDone.add(pathKey(job.path));
    jobDone(job);
  },
  /**
   * 窓を閉じる操作をまねる（約束 版6）。処理中か、画面が setUnsavedChanges(true) を知らせているときだけ画面に知らせる。
   * どちらでもなければ、エンジンと同じく確かめずに閉じる
   */
  simulateCloseRequest(): boolean {
    if ((job && job.running) || unsavedChanges) ev.close.emit();
    else ev.notice.emit({ kind: "closed", text: "（見本）ここでアプリが閉じます（処理中でも手直しありでもないので、確かめない）" });
    return true;
  },
  /** 台本どおりの名前 */
  demoNames(): Record<string, string> {
    if (scenario.data === "large") return { ...LARGE_DEMO_NAMES };
    const names = fixtures.names();
    for (const s of speakersFor()) names[s.label] ??= "";
    return names;
  },
  /** 台本どおりの名前に、同じ名前のまとめを1つ足したもの */
  mergeNames(): Record<string, string> {
    const names = mockDev.demoNames();
    const labels = speakersFor().map((s) => s.label);
    const last = labels[labels.length - 1];
    const target = names["話者B"] || names[labels[0]];
    if (last && target) names[last] = target;
    return names;
  },
};

export type MockDev = typeof mockDev;
