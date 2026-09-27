// 見本のデータ（開発サーバのときだけ使う）。contract/fixtures をそのまま読み、「多い」データはここで作る。
import type {
  AppError,
  EnvironmentCheck,
  ErrorCode,
  FileInfo,
  HistoryItem,
  JobDone,
  JobProgress,
  Line,
  ModelInfo,
  SpeakerCard,
  SpeakerWarning,
  TalkTime,
  TranscriptView,
  UnresolvedHint,
} from "@contract/types";
import envMacJson from "@contract/fixtures/environment_mac.json";
import envProblemJson from "@contract/fixtures/environment_problem_example.json";
import envWindowsJson from "@contract/fixtures/environment_windows_example.json";
import errorsJson from "@contract/fixtures/errors.json";
import file68Json from "@contract/fixtures/file_info_68min_example.json";
import fileJson from "@contract/fixtures/file_info.json";
import fileUnsupportedJson from "@contract/fixtures/file_unsupported_example.json";
import historyJson from "@contract/fixtures/history_example.json";
import jobProgressJson from "@contract/fixtures/job_progress_example.json";
import modelsDownloadingJson from "@contract/fixtures/models_downloading_example.json";
import modelsInitialJson from "@contract/fixtures/models_initial.json";
import namesJson from "@contract/fixtures/names.json";
import speakersJson from "@contract/fixtures/speakers.json";
import speakersWarningsJson from "@contract/fixtures/speakers_warnings_example.json";
import transcriptJson from "@contract/fixtures/transcript.json";
import transcriptRepeatJson from "@contract/fixtures/transcript_repeat_example.json";
import transcriptUnresolvedJson from "@contract/fixtures/transcript_unresolved_example.json";
import unresolvedHintsJson from "@contract/fixtures/unresolved_hints.json";

/** JSON を約束の型として読む（中身は fixtures が正しい前提。書き換えないよう写しを返す） */
function copy<T>(json: unknown): T {
  return structuredClone(json) as T;
}

const sampleUrls = import.meta.glob<string>("../../../contract/fixtures/samples/*.wav", {
  query: "?url",
  import: "default",
  eager: true,
});

/** fixtures からの相対パス（samples/話者A_1.wav）→ 開発サーバの URL */
export function sampleUrl(audioPath: string): string {
  return sampleUrls[`../../../contract/fixtures/${audioPath}`] ?? "";
}

const SAMPLE_PATHS = Object.keys(sampleUrls)
  .map((k) => k.replace("../../../contract/fixtures/", ""))
  .filter((p) => p.includes("話者"))
  .sort();

export const fixtures = {
  envMac: () => copy<EnvironmentCheck>(envMacJson),
  envWindows: () => copy<EnvironmentCheck>(envWindowsJson),
  envProblem: () => copy<EnvironmentCheck>(envProblemJson),
  modelsInitial: () => copy<ModelInfo[]>(modelsInitialJson),
  modelsDownloading: () => copy<ModelInfo[]>(modelsDownloadingJson),
  file: () => copy<FileInfo>(fileJson),
  file68: () => copy<FileInfo>(file68Json),
  fileUnsupported: () => copy<FileInfo>(fileUnsupportedJson),
  speakers: () => copy<SpeakerCard[]>(speakersJson),
  speakersWarnings: () => copy<SpeakerCard[]>(speakersWarningsJson),
  hints: () => copy<UnresolvedHint[]>(unresolvedHintsJson),
  names: () => copy<Record<string, string>>(namesJson),
  transcript: () => copy<TranscriptView>(transcriptJson),
  transcriptUnresolved: () => copy<TranscriptView>(transcriptUnresolvedJson),
  transcriptRepeat: () => copy<TranscriptView>(transcriptRepeatJson),
  /** 版8: 履歴の一覧の作例 */
  history: () => copy<HistoryItem[]>(historyJson),
};

export function fixtureError(code: ErrorCode, detail?: string): AppError {
  const e = copy<Record<string, AppError>>(errorsJson)[code];
  return detail ? { ...e, detail } : e;
}

// ---- 処理中の知らせ（job_progress_example.json を縮めて流す） ---------------------------

export type TimelineEvent =
  | { atSec: number; event: "progress"; data: JobProgress }
  | { atSec: number; event: "done"; data: JobDone };

/** job_progress_example.json の録音の長さ（68分） */
export const EXAMPLE_DURATION_SEC = 4068.9;

/**
 * 68分の録音の知らせの流れ。scale で書き起こし以降の時間を伸ばす（「多い」データの4時間用）。
 * reused なら話者の判定を飛ばし、前回の結果を使い回した流れにする
 */
export function progressTimeline(scale: number, reused: boolean): TimelineEvent[] {
  const base = copy<TimelineEvent[]>(jobProgressJson);
  const transcribeStart = 22;
  const diarizeSec = 21;
  const out: TimelineEvent[] = [];
  for (const ev of base) {
    if (reused && ev.event === "progress" && ev.data.stage === "diarize") continue;
    let at = ev.atSec;
    if (at >= transcribeStart) at = transcribeStart + (at - transcribeStart) * scale;
    if (reused && ev.atSec > 1) at -= diarizeSec;
    at = Math.max(0, at);
    if (ev.event === "progress") {
      const eta = ev.data.etaSec === null ? null : Math.round(ev.data.etaSec * scale);
      out.push({ atSec: at, event: "progress", data: { ...ev.data, etaSec: eta, elapsedSec: Math.round(at), reusedDiarization: reused } });
    } else {
      out.push({ atSec: at, event: "done", data: { ...ev.data } });
    }
  }
  return out;
}

// ---- 「多い」データ（4時間・10ラベル・確認用60件・約1,000行） --------------------------------

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const LARGE_LABELS: Array<[string, number]> = [
  ["話者A", 0.16],
  ["話者B", 0.14],
  ["話者C", 0.12],
  ["話者D", 0.11],
  ["話者E", 0.02],
  ["話者F", 0.12],
  ["話者G", 0.1],
  ["話者H", 0.09],
  ["話者I", 0.1],
  ["話者J", 0.04],
];

const SHORT_TEXTS = ["はい", "そうですね", "うんうん", "ええ", "あはい"];
const MISHEARD = ["ご視聴ありがとうございました", "うん", "おつかれさまでした", "チャンネル登録お願いします", "はい", "えー", "次回もお楽しみに", "んー"];

const LARGE_HINTS: Record<string, { hints: SpeakerCard["hints"]; warnings: SpeakerWarning[] }> = {
  話者A: { hints: [{ name: "田中", sources: { 自己紹介: 2, 呼びかけ直後: 4 } }], warnings: [] },
  話者B: { hints: [{ name: "佐藤", sources: { 呼びかけ直後: 6 } }], warnings: [] },
  話者C: { hints: [{ name: "鈴木", sources: { 自己紹介: 1 } }, { name: "高橋", sources: { 自己紹介: 1 } }], warnings: ["mixed_voices"] },
  話者D: { hints: [{ name: "高橋", sources: { 自己紹介: 1, 呼びかけ直後: 3 } }], warnings: [] },
  話者E: { hints: [], warnings: ["short_talk"] },
  話者F: { hints: [{ name: "伊藤", sources: { 自己紹介: 1 } }], warnings: [] },
  話者G: { hints: [{ name: "渡辺", sources: { 呼びかけ直後: 2 } }, { name: "渡部", sources: { 呼びかけ直後: 1 } }], warnings: [] },
  話者H: { hints: [{ name: "山本", sources: { 自己紹介: 1, 呼びかけ直後: 1 } }], warnings: [] },
  話者I: { hints: [], warnings: [] },
  話者J: { hints: [], warnings: ["short_talk"] },
};

export const LARGE_DEMO_NAMES: Record<string, string> = {
  話者A: "田中",
  話者B: "佐藤",
  話者C: "鈴木",
  話者D: "高橋",
  話者E: "",
  話者F: "伊藤",
  話者G: "渡辺",
  話者H: "山本",
  話者I: "",
  話者J: "",
};

export interface LargeData {
  file: FileInfo;
  transcript: TranscriptView;
  speakers: SpeakerCard[];
}

let largeCache: LargeData | null = null;

export function largeData(): LargeData {
  if (largeCache) return structuredClone(largeCache);
  const r = rng(777);
  const total = 14400;
  const pool = fixtures.transcript().utterances.map((u) => u.text);
  type Raw = { start: number; end: number; label: string; text: string; overlap: boolean };
  const said: Raw[] = [];
  let t = 4;
  let prev = "";
  while (t < total - 12) {
    let label = LARGE_LABELS[0][0];
    do {
      const x = r();
      let acc = 0;
      for (const [k, w] of LARGE_LABELS) {
        acc += w;
        if (x < acc) {
          label = k;
          break;
        }
      }
    } while (label === prev && r() < 0.85);
    const short = label === "話者E" || label === "話者J";
    const text = short ? SHORT_TEXTS[Math.floor(r() * SHORT_TEXTS.length)] : pool[Math.floor(r() * pool.length)];
    const dur = short ? 1 + r() * 1.5 : 3 + text.length * 0.12 + r() * 4;
    const start = Math.round(t * 100) / 100;
    said.push({ start, end: Math.round((start + dur) * 100) / 100, label, text, overlap: r() < 0.05 });
    t += dur + 0.6 + r() * 2.2;
    prev = label;
  }
  const unres: Raw[] = [];
  for (let i = 0; i < 60; i++) {
    const s = Math.round((90 + r() * (total - 120)) * 100) / 100;
    unres.push({ start: s, end: Math.round((s + 1 + r() * 3) * 100) / 100, label: "不明", text: MISHEARD[Math.floor(r() * MISHEARD.length)], overlap: false });
  }
  const all = [...said.map((x) => ({ ...x, u: false })), ...unres.map((x) => ({ ...x, u: true }))].sort((a, b) => a.start - b.start);
  const utterances: Line[] = [];
  const unresolved: Line[] = [];
  all.forEach((x, i) => {
    const line: Line = { id: `u${i}`, start: x.start, end: x.end, label: x.label, speaker: x.label, text: x.text, overlap: x.overlap };
    (x.u ? unresolved : utterances).push(line);
  });

  const secBy: Record<string, number> = {};
  for (const u of utterances) secBy[u.label] = (secBy[u.label] ?? 0) + (u.end - u.start);
  const speech = Object.values(secBy).reduce((a, b) => a + b, 0);
  const talkTime: TalkTime[] = Object.entries(secBy)
    .map(([speaker, sec]) => ({ speaker, sec: Math.round(sec * 100) / 100, share: Math.round((sec / speech) * 10000) / 10000 }))
    .sort((a, b) => b.sec - a.sec);

  let sampleNo = 0;
  const speakers: SpeakerCard[] = talkTime.map(({ speaker, sec, share }) => {
    const mine = utterances.filter((u) => u.label === speaker);
    const used = new Set<number>();
    const pick = (f: number) => {
      const c = Math.floor((mine.length - 1) * f);
      const w = Math.min(3, Math.floor(mine.length / 6));
      let best = -1;
      for (let k = Math.max(0, c - w); k <= Math.min(mine.length - 1, c + w); k++) {
        if (!used.has(k) && (best < 0 || mine[k].text.length > mine[best].text.length)) best = k;
      }
      if (best < 0) best = mine.findIndex((_, k) => !used.has(k));
      if (best >= 0) used.add(best);
      return best;
    };
    const idx = [0.1, 0.5, 0.9].map(pick).filter((k) => k >= 0);
    const meta = LARGE_HINTS[speaker] ?? { hints: [], warnings: [] };
    return {
      label: speaker,
      talkSec: sec,
      share,
      utterances: mine.length,
      firstSec: mine[0]?.start ?? 0,
      hints: meta.hints,
      warnings: meta.warnings,
      samples: meta.warnings.includes("short_talk")
        ? []
        : idx.map((k, i) => ({
            index: i + 1,
            start: mine[k].start,
            end: mine[k].end,
            text: Array.from(mine[k].text).length > 70 ? Array.from(mine[k].text).slice(0, 70).join("") + "…" : mine[k].text,
            audioPath: SAMPLE_PATHS[sampleNo++ % SAMPLE_PATHS.length],
          })),
    };
  });

  const base = fixtures.transcript();
  largeCache = {
    file: {
      path: "/Users/example/Movies/長時間会議_合成.m4a",
      name: "長時間会議_合成.m4a",
      sizeBytes: 228_000_000,
      durationSec: total,
      hasVideo: false,
      supported: true,
      estimate: { minSec: 2880, maxSec: 5760 },
    },
    transcript: {
      ...base,
      title: "長時間会議_合成",
      source: "/Users/example/Movies/長時間会議_合成.m4a",
      durationSec: total,
      named: false,
      talkTime,
      utterances,
      unresolved,
      repeats: [],
    },
    speakers,
  };
  return structuredClone(largeCache);
}

// ---- 結果の画面の行の再生（見本には録音の全体が無いので、長さぶんの無音を返す） --------------------

const silentCache = new Map<number, string>();

export function silentWavUrl(sec: number): string {
  const tenths = Math.max(3, Math.min(600, Math.round(sec * 10)));
  const cached = silentCache.get(tenths);
  if (cached) return cached;
  const rate = 8000;
  const n = Math.round((tenths / 10) * rate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, "data");
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  silentCache.set(tenths, url);
  return url;
}
