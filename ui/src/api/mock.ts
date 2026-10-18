// 受け渡しの約束（contract/api.ts の KikiwakeApi）の見本実装。contract/fixtures を返す。
// 開発サーバのときだけ読み込まれる（製品のビルドには入らない）。作例の切替は mockDev から行う（開発用の切替パネル）。
import type { KikiwakeApi, Unsubscribe } from "@contract/api";
import type {
  EnvironmentCheck,
  FileInfo,
  HistoryItem,
  HistoryOpened,
  JobDone,
  JobDraft,
  JobFailed,
  JobProgress,
  Locale,
  ModelInfo,
  NamedSpeakers,
  Names,
  SaveResult,
  ScreensInfo,
  SpeakerCard,
  SpeechLanguage,
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
  save: "normal" | "existing" | "failed" | "notWritable";
  applyFails: boolean;
  /** 見本: 保存したファイルを移した・消した（Finder で表示すると見つからない） */
  savedMissing: boolean;
  /** 版10: 新しい版があるか（起動したときの確認の答え。切り替えたら読み込み直すと出る） */
  update: "none" | "available";
  /** 版15: 録音の言語を「自動で見分ける」で始めたときに、見分けた言語（見本） */
  speech: SpeechLanguage;
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
  savedMissing: false,
  update: "none",
  speech: "ja",
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

/** 版7: 画面が知らせた言語（エンジンと同じく、保存するファイルの名前を合わせる） */
let locale: Locale = "ja";
/** 版12: 保存するファイルの名前（拡張子なし）。「<元ファイルの名前>_文字起こし」（英語の画面では「_transcript」） */
const savedStem = (path: string) => `${stemOf(baseName(path))}_${locale === "en" ? "transcript" : "文字起こし"}`;

/** 版13: マニュアルの素材の zip の名前 */
const zipNameOf = (path: string) => `${stemOf(baseName(path))}_${locale === "en" ? "manual_materials" : "マニュアル素材"}.zip`;
/** 版13: マニュアル用にした録音（鍵）。見本の数（作り物の画面共有の録画をアプリで通したときと同じ） */
const screensKeys = new Set<string>();
const MOCK_SCREENS: ScreensInfo = { frames: 5, scenes: 3, steps: 1, faces: 0 };

/** 版12: 保存先の既定は元ファイルと同じフォルダ（版11までは隣の「<名前>_文字起こし/」） */
function outDirFor(path: string): string {
  return dirOf(path);
}

/** 見本の作例: 保存したことがある録音の、保存したファイル */
function exampleSavedFile(path: string): string {
  return joinPath(outDirFor(path), `${savedStem(path)}.md`);
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
/** 版8: 履歴（作例から始め、見本で処理した録音を上に足す）・閉じたときの状態（録音ごと）・ジョブの録音 */
let history: HistoryItem[] = fixtures.history();
const drafts = new Map<string, JobDraft>();
const jobPaths = new Map<string, string>();

/**
 * 録音の見分け（見本 で足した。2026-09-27）。エンジンは「場所・大きさ・更新日時」で見分けるので、
 * 同じ場所でもファイルが変わると別の録音になる。見本は場所で見分けてきたので、同じ場所にある「変わる前の録音」には
 * 別の鍵を持たせる（世代）。作例を切り替えなければ、鍵は今までどおり場所だけ
 */
const itemKeys = new Map<string, string>();
const pathGen = new Map<string, number>();
/** 元のファイルの状態の作例（約束 版9 の sourceState。開発用の切替の「案A の作例」から） */
type SourceCase = "missing" | "changed-same" | "changed-diff";
const sourceCases = new Map<string, SourceCase>();

const keyOfPath = (path: string): string => {
  const k = pathKey(path);
  const g = pathGen.get(k) ?? 0;
  return g ? `${k}#${g}` : k;
};
const keyOfItem = (h: HistoryItem): string => itemKeys.get(h.jobId) ?? pathKey(h.path);
function keyOfJob(jobId: string): string {
  const known = itemKeys.get(jobId);
  if (known) return known;
  const path = jobPaths.get(jobId) ?? history.find((h) => h.jobId === jobId)?.path;
  return path ? keyOfPath(path) : jobId;
}
/** その場所に、文字起こししたあとでファイルが変わった録音があるか（あれば、今そこにあるファイルは別の新しい録音） */
function changedAt(path: string): HistoryItem | undefined {
  const k = keyOfPath(path);
  return history.find((h) => keyOfItem(h) === k && (sourceCases.get(h.jobId) ?? "").startsWith("changed"));
}
/** 今その場所にあるファイルの鍵（変わった録音があれば、次の世代） */
function freshKeyOf(path: string): string {
  return changedAt(path) ? `${pathKey(path)}#${(pathGen.get(pathKey(path)) ?? 0) + 1}` : keyOfPath(path);
}

/** 版6: 書き起こしまで済んだ録音（選び直すと、書き起こしをやり直さずに1秒ほどで名前付けへ）と、そのとき確定した名前 */
const transcriptDone = new Set<string>();
const namesByPath = new Map<string, Names>();

/** 版15: 録音（鍵）ごとに決めた言語（エンジンの asr_language.json）。記録が無く書き起こしがあれば日本語（1.1.x までの録音） */
interface MockSpeech {
  language: SpeechLanguage;
  detected: boolean;
}
const speechByKey = new Map<string, MockSpeech>();
function speechOf(key: string): MockSpeech | undefined {
  return speechByKey.get(key) ?? (transcriptDone.has(key) ? { language: "ja", detected: false } : undefined);
}
const speechFields = (s: MockSpeech | undefined) =>
  s ? { language: s.language, ...(s.detected ? { languageDetected: true } : {}) } : {};

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
  /** 録音の鍵（keyOfPath。変わったファイルを新しく処理すると、前の録音とは別の鍵） */
  key: string;
  timers: number[];
  running: boolean;
  diarizationKept: boolean;
  /** 版15: この処理で決めた録音の言語 */
  speech: MockSpeech;
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
  remember(j, "unfinished");
  ev.failed.emit({ jobId: j.id, error, diarizationKept: j.diarizationKept });
}

/**
 * 版9: 付けた名前（エンジンと同じ: 同じ名前は1人にまとめ、発言の多い順。名前を付けていない話者の数も）。
 * 見本は話者カードの発言時間で数える（エンジンは話者の判定の区間から。同じ値）
 */
function namedSpeakersFor(names: Names | undefined): NamedSpeakers | undefined {
  if (!names) return undefined;
  const talk = new Map<string, number>();
  let unnamed = 0;
  for (const c of speakersFor()) {
    const who = (names[c.label] ?? "").trim();
    if (who) talk.set(who, (talk.get(who) ?? 0) + c.talkSec);
    else unnamed += 1;
  }
  if (!talk.size) return undefined;
  return { names: [...talk.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n), unnamed };
}

/** 版8: 処理した録音を履歴の一番上に（同じ録音は置き換える） */
function remember(j: MockJob, status: HistoryItem["status"]) {
  const names = namesByPath.get(j.key);
  const draft = drafts.get(j.key);
  const namedSpeakers = namedSpeakersFor(names);
  const item: HistoryItem = {
    jobId: j.id,
    name: baseName(j.path),
    path: j.path,
    durationSec: supportedBase().durationSec,
    processedAt: new Date().toISOString().slice(0, 10),
    status,
    ...(status === "done" || j.diarizationKept ? { speakers: speakersFor().length } : {}),
    named: Boolean(names && Object.values(names).some((v) => v.trim())),
    unsavedEdits: Boolean(draft?.unsaved),
    sourceAvailable: true,
    diarizationKept: j.diarizationKept,
    sourceState: "ok",
    saved: status === "done" && Boolean(draft?.savedOnce || draft?.savedFiles?.length),
    ...(namedSpeakers ? { namedSpeakers } : {}),
    // 版15: 書き起こしまで進んだ録音だけ（エンジンは書き起こしを始めるときに言語を記録する）
    ...(status === "done" || j.diarizationKept ? { language: j.speech.language } : {}),
  };
  itemKeys.set(j.id, j.key);
  history = [item, ...history.filter((h) => keyOfItem(h) !== j.key)];
}

function jobDone(j: MockJob) {
  j.running = false;
  stopTimers(j);
  transcriptDone.add(j.key);
  remember(j, "done");
  const t = baseTranscript();
  const names = namesByPath.get(j.key);
  const draft = drafts.get(j.key);
  ev.done.emit({
    jobId: j.id,
    outDir: outDirFor(j.path),
    speakers: speakersFor().length,
    unresolvedCount: t.unresolved.length,
    language: j.speech.language,
    ...(j.speech.detected ? { languageDetected: true } : {}),
    ...(names && Object.keys(names).length ? { names: { ...names } } : {}),
    ...(draft ? { draft: structuredClone(draft) } : {}),
    ...(screensKeys.has(j.key) ? { screens: { ...MOCK_SCREENS } } : {}),
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
    diarizationDone.add(j.key);
    // 版15: 言語は書き起こしの段階の頭で決まる
    Object.assign(p, speechFields(j.speech));
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

/** 版8: 履歴から開いた録音（作例は合成会議の結果を出す） */
/** 見本の作例: 保存したことがある録音の閉じたときの状態（保存後に手直しがあれば、手直しした行を1つ） */
function savedExampleDraft(item: HistoryItem): JobDraft {
  const file = exampleSavedFile(item.path);
  if (item.unsavedEdits) {
    return {
      screen: "result",
      unsaved: true,
      savedOnce: true,
      savedFiles: [],
      lastSavedFiles: [file],
      textHistory: { u0: ["（見本）保存したあとで直した文"] },
    };
  }
  return { screen: "naming", unsaved: false, savedOnce: true, savedFiles: [file], lastSavedFiles: [file] };
}

function opened(item: HistoryItem, sourceAvailable: boolean): HistoryOpened {
  const key = keyOfItem(item);
  itemKeys.set(item.jobId, key);
  jobPaths.set(item.jobId, item.path);
  transcriptDone.add(key);
  diarizationDone.add(key);
  if (item.named && !namesByPath.has(key)) namesByPath.set(key, fixtures.names());
  const names = namesByPath.get(key);
  if (names) appliedNames.set(item.jobId, { ...names });
  // 見本の作例で「保存したことがある」録音は、保存したときの記録を持たせる（開いても一覧の印と同じになるように）
  const draft = drafts.get(key) ?? (item.saved ? savedExampleDraft(item) : undefined);
  // 元のファイルのフォルダが無い（見つからない）録音は、エンジンと同じく保存先の既定を書類フォルダにする
  const missing = (sourceCases.get(item.jobId) ?? item.sourceState) === "missing";
  const speech = speechOf(key) ?? { language: item.language ?? "ja", detected: false };
  return {
    jobId: item.jobId,
    outDir: missing ? osPath("/Users/example/Documents") : outDirFor(item.path),
    speakers: speakersFor().length,
    unresolvedCount: baseTranscript().unresolved.length,
    language: speech.language,
    ...(speech.detected ? { languageDetected: true } : {}),
    ...(names && Object.keys(names).length ? { names: { ...names } } : {}),
    ...(draft ? { draft: structuredClone(draft) } : {}),
    ...(screensKeys.has(key) ? { screens: { ...MOCK_SCREENS } } : {}),
    sourceAvailable,
  };
}

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
    // 版13: 録画（mp4・mov）は映像ありにして、マニュアル用にする場合の目安を付ける（エンジンと同じ係数）
    info.hasVideo = ext === "mp4" || ext === "mov";
    delete info.estimateScreens;
    const key = freshKeyOf(path);
    const reusable = scenario.file === "previous" || diarizationDone.has(key);
    const resultReusable = transcriptDone.has(key);
    // 同じ場所の録音を前に文字起こししていて、そのあとファイルが変わった（約束 版9）
    const changed = changedAt(path);
    if (changed) info.previousChanged = { processedAt: changed.processedAt };
    if (reusable) {
      const speech = speechOf(key);
      info.previous = {
        outDir: outDirFor(path),
        diarizationReusable: true,
        processedAt: base.previous?.processedAt ?? new Date().toISOString().slice(0, 10),
        resultReusable,
        // 版15: 前回の書き起こしの言語と、違う言語でやり直すときの目安
        ...(speech ? { language: speech.language } : {}),
        ...(resultReusable ? { estimateRedo: { ...base.estimate } } : {}),
      };
      // 版6: 前回の書き起こしを使い回すときは数秒（エンジンと同じ）
      if (resultReusable) info.estimate = { minSec: 1, maxSec: 10 };
    } else delete info.previous;
    if (info.hasVideo) {
      const d = info.durationSec;
      info.estimateScreens = {
        minSec: Math.max(info.estimate.minSec, Math.round(d * 0.03)),
        maxSec: Math.max(info.estimate.maxSec, Math.round(d * 0.1)) + 5,
      };
    }
    return info;
  },

  async startJob({ path, screens, language }) {
    await wait(120);
    if (job) {
      job.running = false;
      stopTimers(job);
    }
    // 変わったファイルを処理する: 前の録音は今の鍵のまま残し、この場所は次の世代にする（エンジンでは ID が変わる）
    const old = changedAt(path);
    if (old) {
      itemKeys.set(old.jobId, keyOfItem(old));
      pathGen.set(pathKey(path), (pathGen.get(pathKey(path)) ?? 0) + 1);
    }
    const key = keyOfPath(path);
    if (screens) screensKeys.add(key);
    const reused = scenario.file === "previous" || diarizationDone.has(key);
    // 版15: 録音の言語（選んだ言語 → 前回の言語 → 自動で見分ける）。前回と違う言語なら書き起こしからやり直す
    const before = speechOf(key);
    const speech: MockSpeech = language ? { language, detected: false } : (before ?? { language: scenario.speech, detected: true });
    if (before && before.language !== speech.language) transcriptDone.delete(key);
    speechByKey.set(key, speech);
    const j: MockJob = { id: `job-mock-${++jobSeq}`, path, key, timers: [], running: true, diarizationKept: reused, speech };
    job = j;
    jobPaths.set(j.id, path);
    if (transcriptDone.has(key)) {
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
    // エンジンは確定した名前を作業フォルダに書く（履歴の「名前あり」）。履歴から開いた録音でも同じ
    const key = keyOfJob(jobId);
    namesByPath.set(key, { ...names });
    const item = history.find((h) => keyOfItem(h) === key);
    if (item) item.named = Object.values(names).some((v) => v.trim());
    return applyNamesTo(baseTranscript(), names);
  },

  async getTranscript(jobId, named) {
    await wait(100);
    const t = baseTranscript();
    return named ? applyNamesTo(t, appliedNames.get(jobId) ?? {}) : t;
  },
  async pickFolder(defaultDir) {
    await wait(200);
    // 見本: 「書類/議事録」と「デスクトップ」の間で切り替える（製品では OS のフォルダ選択画面）
    const minutes = osPath("/Users/example/Documents/議事録");
    const desktop = osPath("/Users/example/Desktop");
    return defaultDir && pathKey(defaultDir) === pathKey(minutes) ? desktop : minutes;
  },
  async saveOutputs(jobId, req): Promise<SaveResult> {
    await wait(600);
    if (scenario.save === "failed") {
      throw fixtureError("disk_full", "save_outputs: No space left on device (os error 28)\n（見本の作例）");
    }
    if (scenario.save === "notWritable") {
      throw fixtureError("not_writable", `${req.dir}: Permission denied (os error 13)\n（見本の作例）`);
    }
    // 版12: 録音の名前入り（名前を付けたかどうかでは変えない）。選んだフォルダにそのまま書く
    const path = jobPaths.get(jobId) ?? history.find((h) => h.jobId === jobId)?.path ?? scenarioFilePath();
    const files = req.formats.map((f) => joinPath(req.dir, `${savedStem(path)}.${f}`));
    // 版13: マニュアルの素材の zip
    if (req.screens) files.push(joinPath(req.dir, zipNameOf(path)));
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
    // 見本 の作例: 保存したファイルを移した・消した
    if (scenario.savedMissing && /_(文字起こし|transcript)\.(md|txt|json)$/.test(path)) {
      throw fixtureError("file_not_found", `${path}（見本の作例）`);
    }
    const where = scenario.os === "windows" ? "エクスプローラー" : "Finder";
    ev.notice.emit({ kind: "text", text: `（見本）${where}で表示：${path}` });
  },

  onCloseRequested: (cb) => ev.close.on(() => cb()),
  async closeApp() {
    await wait(50);
    if (job) {
      job.running = false;
      stopTimers(job);
    }
    ev.notice.emit({ kind: "closed", text: "（見本）ここでアプリが閉じます" });
  },
  // 版7: 画面の言語（見本では既定の保存先の名前だけ合わせる。Mac のメニューと保存するファイルの中はアプリの中だけ）
  async setLocale(l) {
    locale = l;
  },

  // ---- 版8: 履歴・閉じたときの状態 ----
  async listHistory() {
    await wait(120);
    const running = job && job.running ? job.key : null;
    return history
      .filter((h) => keyOfItem(h) !== running)
      .map((h): HistoryItem => {
        const key = keyOfItem(h);
        const draft = drafts.get(key);
        const c = sourceCases.get(h.jobId);
        const names = namesByPath.get(key);
        const namedSpeakers = names ? namedSpeakersFor(names) : h.namedSpeakers;
        const { namedSpeakers: _fixture, ...rest } = h;
        const saved = h.status === "done" && (h.saved || Boolean(draft?.savedOnce || draft?.savedFiles?.length));
        // 版12: 最後に保存したファイル（作例の「保存したことがある」録音は、元ファイルと同じフォルダに保存したことにする）
        const savedFiles = draft ? (draft.lastSavedFiles ?? draft.savedFiles ?? []) : saved ? [exampleSavedFile(h.path)] : [];
        return {
          ...rest,
          named: names ? Object.values(names).some((v) => v.trim()) : h.named,
          unsavedEdits: h.status === "done" && (draft?.unsaved ?? h.unsavedEdits),
          // 版9: 元のファイルの状態（作例の切替があればそれ）・保存したことがあるか・付けた名前
          sourceState: c ? (c === "missing" ? "missing" : "changed") : h.sourceState,
          saved,
          ...(namedSpeakers ? { namedSpeakers } : {}),
          ...(saved && savedFiles.length ? { savedFiles } : {}),
        };
      });
  },
  async openHistory(jobId) {
    await wait(400);
    const item = history.find((h) => h.jobId === jobId);
    if (!item) throw fixtureError("file_not_found", `履歴に無い: ${jobId}（見本）`);
    if (item.status !== "done") throw fixtureError("engine_failed", `まだ書き終えていない録音: ${jobId}（見本）`);
    // 処理中の録音は止めない（エンジンも止めない。見本 では処理中にほかの録音を開ける）
    return opened(item, item.sourceAvailable);
  },
  async deleteHistory(jobId) {
    await wait(150);
    const item = history.find((h) => h.jobId === jobId);
    if (!item) return;
    const key = keyOfItem(item);
    history = history.filter((h) => h.jobId !== jobId);
    [drafts, namesByPath].forEach((m) => m.delete(key));
    [transcriptDone, diarizationDone].forEach((m) => m.delete(key));
    sourceCases.delete(jobId);
    itemKeys.delete(jobId);
  },
  async relinkSource(jobId, path) {
    await wait(300);
    const item = history.find((h) => h.jobId === jobId);
    if (!item) throw fixtureError("file_not_found", `履歴に無い: ${jobId}（見本）`);
    // 見本: 名前が同じなら同じ録音とみなす（エンジンは大きさと長さで決める）。
    // 案A の作例「変わった（切った）」は、同じ場所のファイルでも大きさが違うので断る
    if (sourceCases.get(jobId) === "changed-diff" && pathKey(path) === pathKey(item.path)) {
      throw fixtureError("not_same_recording", `大きさ 18234112→16020480（見本の作例）`);
    }
    if (baseName(path) !== item.name) throw fixtureError("not_same_recording", `${item.name} ≠ ${baseName(path)}（見本）`);
    const oldKey = keyOfItem(item);
    const newKey = pathKey(path) === pathKey(item.path) ? oldKey : keyOfPath(path);
    if (newKey !== oldKey) {
      for (const m of [drafts, namesByPath] as Array<Map<string, unknown>>) {
        if (m.has(oldKey)) m.set(newKey, m.get(oldKey));
        m.delete(oldKey);
      }
      for (const m of [transcriptDone, diarizationDone]) {
        if (m.delete(oldKey)) m.add(newKey);
      }
    }
    itemKeys.set(jobId, newKey);
    item.path = path;
    item.sourceAvailable = true;
    sourceCases.delete(jobId);
    return opened(item, true);
  },
  async saveDraft(jobId, draft) {
    const path = jobPaths.get(jobId) ?? history.find((h) => h.jobId === jobId)?.path;
    if (!path) return;
    const key = keyOfJob(jobId);
    drafts.set(key, structuredClone(draft));
    // エンジンと同じく、手直しした録音を履歴の一番上に（最後に使った順）
    const item = history.find((h) => keyOfItem(h) === key);
    if (item) history = [item, ...history.filter((h) => h !== item)];
  },

  // ---- 版10: 新しい版の知らせ ----
  async checkUpdate() {
    await wait(300);
    if (scenario.update !== "available") return null;
    return {
      version: "1.0.1",
      current: "1.0.0",
      title: "Kikiwake 1.0.1",
      notes: "- 長い録音で、保存の帯が隠れることがあったのを直しました\n- 一覧の行に、付けた名前を出すようにしました",
      publishedAt: "2026-10-05",
      url: "https://github.com/enomoso-pm/kikiwake/releases/tag/v1.0.1",
    };
  },
  async openReleasePage(version) {
    await wait(50);
    ev.notice.emit({ kind: "text", text: `（見本）ブラウザで v${version} のリリースのページを開きます` });
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
    diarizationDone.add(job.key);
    jobDone(job);
  },
  /**
   * 窓を閉じる操作をまねる（約束 版5）。処理中のときだけ画面に知らせる。そうでなければ、エンジンと同じく確かめずに閉じる
   * （版8: 保存していない手直しは作業フォルダに残るので確かめない）
   */
  simulateCloseRequest(): boolean {
    if (job && job.running) ev.close.emit();
    else ev.notice.emit({ kind: "closed", text: "（見本）ここでアプリが閉じます（処理中ではないので、確かめない。手直しは履歴に残る）" });
    return true;
  },
  /** 見本 の作例: 元のファイルの状態（ある・見つからない・変わった。変わったは長さが同じか違うか） */
  setSourceState(jobId: string, state: "ok" | SourceCase) {
    const item = history.find((h) => h.jobId === jobId);
    if (!item) return;
    if (state === "ok") sourceCases.delete(jobId);
    else sourceCases.set(jobId, state);
    item.sourceAvailable = state === "ok";
    item.sourceState = state === "ok" ? "ok" : state === "missing" ? "missing" : "changed";
  },
  /** 見本 の作例: 処理中と順番待ちを作るときのファイル（中身は見本の合成会議） */
  demoPaths(): string[] {
    return ["定例会議_1001.m4a", "1on1_1002.m4a", "顧客ヒアリング_1003.mp4"].map((n) => joinPath(osPath("/Users/example/Movies"), n));
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
