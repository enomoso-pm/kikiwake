// 画面の文字（英語）。形は ja.ts と同じ（Messages）。
// エンジン（Rust）が日本語で返す文は、種類の目印（エラーの code・動作条件の文・モデルの id）で英語にする。知らない文はそのまま出す
import type { AppError, EnvironmentItem, ModelId, RepeatNotice, SpeakerWarning, Stage } from "@contract/types";
import type { Messages } from "./ja";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const pad2 = (n: number) => String(n).padStart(2, "0");
/** 繰り返しの知らせの時刻（エンジンと同じ h:mm:ss） */
const hms = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 3600)}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
};

/** エンジンのエラー（code ごと。disk_full と cancelled は文から数や場合を読む） */
const ERRORS: Record<string, string> = {
  file_not_found: "The file can't be found. Check that it hasn't been moved or deleted.",
  unsupported_format: "This format isn't supported. Supported formats: mp4, mov, m4a, mp3, wav",
  no_audio_track: "This file has no audio.",
  model_missing: "The AI models can't be found. Please run the setup again.",
  network_unreachable: "Can't connect to the model download site (huggingface.co). Check your network connection.",
  download_failed: "The download stopped partway. Resume to continue where it left off.",
  checksum_mismatch: "A downloaded file was corrupted. Please download it again.",
  engine_failed: "Something went wrong during processing. Please try again. If it keeps happening, copy the details and let us know.",
  out_of_memory: "Ran out of memory. Close other apps and try again.",
  not_same_recording: "The file you chose differs from this recording in size or length. Choose the original recording.",
};

/** 動作条件の表示文（エンジンの文そのものから） */
const ENVIRONMENT: Record<string, string> = {
  対応しています: "Supported",
  "macOS 14 以降が必要です。": "Requires macOS 14 or later.",
  "Apple シリコン（M1 以降）の Mac が必要です。": "Requires a Mac with Apple silicon (M1 or later).",
  足りています: "Enough",
  "長い録音では、他のアプリを閉じてから実行してください。": "For long recordings, close other apps first.",
  "8 GB 以上のメモリが必要です。": "Requires 8 GB of memory or more.",
  "空きが足りません。AI モデルの保存に約 3.2 GB と、作業用の空きが要ります。":
    "Not enough free space. The AI models need about 3.2 GB, plus room for working files.",
  "今は足ります。長い録音を続けて処理すると足りなくなることがあります。":
    "Enough for now, but processing several long recordings may run out of space.",
  モデルと作業用に足りています: "Enough for the models and working files",
  使えます: "Available",
  "使えません。時間がかかります。": "Not available. Processing will take longer.",
};

const MODEL_LABEL: Partial<Record<ModelId, string>> = {
  "whisper-large-v3": "transcription",
  "nemotron-3-diarization": "speaker detection",
};

const HINT_KIND: Record<string, string> = { 自己紹介: "self-intro", 呼びかけ直後: "addressed" };

export const en: Messages = {
  lang: {
    label: "Display language",
  },

  common: {
    noName: "Unnamed",
    copyDetail: "Copy details",
    play: "▶ Play",
    stop: "■ Stop",
    close: "Close",
    backToTranscript: "← Back to transcript",
    reveal: (isMac: boolean) => (isMac ? "Show in Finder" : "Show in File Explorer"),
    listSep: ", ",
    labels: (labels: string[]) => labels.join(", "),
  },

  step: {
    aria: "Steps",
    file: "File",
    processing: "Processing",
    naming: "Names",
    result: "Result",
    pickAnother: "Choose another recording",
    moveTo: (label: string) => `Go to ${label}`,
  },

  time: {
    minutes: (min: number) => `${min} min`,
    hours: (h: number) => `${h} hr`,
    hoursMinutes: (h: number, m: number) => `${h} hr ${m} min`,
    remaining: (t: string) => `About ${t} left`,
    aboutMinutes: (a: number) => `About ${a} min`,
    aboutMinutesRange: (a: number, b: number) => `About ${a}–${b} min`,
    about: (t: string) => `About ${t}`,
    aboutRange: (a: string, b: string) => `About ${a} – ${b}`,
    monthDay: (month: number, day: number) => `${MONTHS[month - 1] ?? month} ${day}`,
    voiceMemo: "m4a (Voice Memos)",
  },

  setup: {
    title: "Let's get set up",
    lead: "Kikiwake checks that it can run on this computer and downloads the AI models it uses for transcription. You only download them once—after that, Kikiwake works offline. Your recordings and transcripts never leave this computer.",
    envTitle: "System requirements",
    envLead:
      "Transcription runs entirely on this computer, so Kikiwake checks that it has enough performance and free space. You can't continue if any item is “Not met”. You can continue with “Caution”, but processing may take longer or stop partway.",
    envLabel: { os: "OS", cpu: "Chip", memory: "Memory", disk: "Free space", gpu: "GPU" },
    level: { ok: "OK", warn: "Caution", error: "Not met" },
    blocked: "Some requirements aren't met, so you can't continue.",
    modelsTitle: "Download the AI models (first time only)",
    modelsLead: (total: string) =>
      `The models total ${total}, which can take tens of minutes depending on your connection. If you pause, the download picks up where it left off. Stay online until it finishes.`,
    modelRole: { "nemotron-3-diarization": "Telling voices apart", "whisper-large-v3": "Turning speech into text" },
    modelTitle: (role: string, label: string) => `${role} (${label} model)`,
    status: {
      missing: "Not downloaded yet",
      downloading: (bytes: string, pct: number) => `Downloading ${bytes} (${pct}%)`,
      partial: (bytes: string) => `Paused at ${bytes} — you can resume`,
      verifying: "Verifying — checking that the downloaded files aren't corrupted",
      ready: "Downloaded",
      error: (bytes: string) => `Failed at ${bytes} — you can resume`,
    },
    next: "Next",
    resume: "Resume download",
    download: (total: string) => `Download (${total} total)`,
    pause: "Pause",
  },

  file: {
    title: "Choose a recording",
    dropHere: "Drag a recording here",
    or: "or",
    pick: "Choose file",
    formats: "Supported formats: mp4, mov, m4a (Voice Memos), mp3, wav",
    japaneseOnly: "Transcription currently supports Japanese recordings only.",
    another: "Choose another file",
    meta: (clock: string, size: string, format: string) => `${clock} · ${size} · ${format}`,
    reuseResultTitle: "Using the previous result",
    reuseResultBody: "Transcription won't run again—you'll go straight to naming. Names you entered last time are filled in.",
    reuseDiarTitle: "Using the previous speaker detection",
    reuseDiarBody: "The previous speaker detection is reused, and processing starts from transcription.",
    processedOn: (day: string) => `This recording was processed on ${day}. `,
    processedBefore: "This recording was processed before. ",
    estimate: "Estimated time",
    soon: "Just a few seconds",
    start: "Start transcription",
  },

  history: {
    open: "History",
    openTitle: "Open a recording you transcribed before",
    back: "← Choose a recording",
    title: "History",
    lead: "Recordings you've transcribed before. Opening one takes you back to where you left off (names or transcript). Unfinished ones continue processing.",
    empty: "Nothing yet. Recordings you transcribe will appear here.",
    meta: (parts: string[]) => parts.join(" · "),
    speakers: (n: number) => `${n} ${plural(n, "speaker", "speakers")}`,
    unfinished: "Unfinished",
    unfinishedDiar: "Speaker detection is done",
    unfinishedNone: "Stopped before speaker detection",
    named: "Named",
    unsaved: "Unsaved edits",
    missing: (unfinished: boolean) =>
      unfinished ? "The original file can't be found, so processing can't continue." : "The original file can't be found. You can read the transcript, but not play it.",
    openItem: "Open",
    resume: "Continue",
    opening: "Opening…",
    delete: "Delete",
    deleteTitle: "Delete from history?",
    deleteBody: (name: string) =>
      `The transcript, names, and edits for “${name}” will be deleted from this Mac's history. The original recording and any transcript files you saved won't be deleted. This can't be undone.`,
    deleteConfirm: "Delete",
    missingBand: "The original file can't be found. You can read the transcript, but lines can't be played. If you moved the file, choose it again to play.",
    relink: "Choose the file again",
    playDisabled: "Can't play because the original file can't be found",
  },

  processing: {
    title: { running: "Transcribing", done: "Finished", cancelled: "Stopped", failed: "Stopped partway" },
    subTranscribe: "This step takes most of the time",
    subReused: "Reusing the previous speaker detection",
    reused: "Used previous result",
    done: "Done",
    waiting: "Waiting",
    cancelled: "Stopped",
    failed: "Failed",
    inProgress: "In progress",
    almostDone: "Almost done",
    calculating: "Estimating time left",
    elapsed: (clock: string) => `Elapsed ${clock}`,
    kept: "The speaker detection results were kept. Trying again reuses them and starts from transcription.",
    notKept: "Speaker detection hadn't finished yet. Trying again starts from the beginning.",
    local: "Processing happens only on this computer.",
    cancel: "Stop",
    back: "Back to file selection",
    retry: "Try again",
  },

  naming: {
    title: "Name the speakers",
    lead: "Listen to each voice and enter who it is. Labels with the same name are merged into one person. Labels left blank stay as “Speaker A” and so on.",
    warning: {
      short_talk: "This label speaks very little. It may be fragments of someone else's voice.",
      mixed_voices: "Two people's voices may be mixed in this label.",
    } as Record<SpeakerWarning, string>,
    position: (index: number) => ({ 1: "Early", 2: "Mid", 3: "Late" } as Record<number, string>)[index] ?? "",
    insertTitle: "Put into the name field",
    merged: " (merged)",
    noName: "No name",
    hasWarning: "Check this",
    talkTime: "Talk time",
    utterances: "Turns",
    times: (n: number) => `${n}`,
    firstSeen: "First heard",
    nameLabel: "Name",
    placeholder: (label: string) => `Leave blank to keep “${label}”`,
    insert: (name: string) => `Use ${name}`,
    clue: "Name clues: ",
    clueNone: "None found",
    mergeNote: (name: string, labels: string) => `${labels} will be merged into one person as “${name}”`,
    noSamples: "No samples to play",
    hintsTitle: "Name clues from unassigned parts",
    hintsLead:
      "These names were said in parts where the speaker couldn't be determined, such as the start of the recording. Listen and compare them with each speaker's voice.",
    insertInto: (name: string, label: string) => `Use ${name} for ${label}`,
    prev: "Previous speaker",
    next: "Next speaker",
    applying: "Merging…",
    backToResult: "Back to transcript →",
    showResult: "View transcript →",
    labelCount: (n: number) => `${n} ${plural(n, "label", "labels")}`,
    saveAs: (labels: string, people: number) => `${labels} → saved as ${people} ${plural(people, "person", "people")}`,
    mergedItem: (labels: string[], name: string) => `${labels.join(" + ")} → ${name}`,
    mergedList: (items: string[]) => ` (${items.join(", ")})`,
    unnamed: (labels: string) => `No name: ${labels} (kept as is)`,
    allNamed: "All labels have names",
    source: (kind: string, n: number) => `${kind} ×${n}`,
    sourceSep: ", ",
    hint: (name: string, sources: string) => `${name} (${sources})`,
  },

  result: {
    backToNaming: "← Back to names",
    title: "Transcript",
    meta: (file: string, clock: string, people: number, rows: string, chars: string) =>
      `${file} · ${clock} · ${people} ${plural(people, "speaker", "speakers")} · ${rows} lines · ${chars} characters`,
    editableNote: "You can go back and change names or merges anytime",
    details: "Details",
    finish: "Finish",
    searchPlaceholder: "Search the transcript",
    matches: (current: number, total: number) => `${current} of ${total}`,
    noMatches: "No matches",
    prev: "Previous",
    next: "Next",
    hint: "* overlapping voices · Double-click a name or text to edit",
    editedRows: (n: number) => `Edited lines: ${n}`,
    revertAll: "Revert all text",
    showPeople: "Show",
    showAll: "Show all",
    rows: (rows: string) => `${rows} lines`,
    shownOf: (total: number, shown: number, rows: string) => `${shown} of ${total} people · ${rows} lines`,
    repeatTitle: "Go to this part of the transcript",
    repeatGo: "Go to this part",
  },

  transcript: {
    nameTip: "Double-click to change the name",
    nameTipOverridden: (label: string) => `Changed for this line only (was: ${label}). Double-click to change`,
    playLine: "Play this line",
    stopLine: "Stop",
    editKeys: (mod: string) => `${mod} + Enter to save · Esc to cancel`,
    editTip: "Double-click to edit the text",
    originalTip: (text: string) => `Original: ${text}`,
    edited: "Edited",
    undoTipPrev: (text: string) => `Previous: ${text}`,
    undoTipOriginal: (text: string) => `Back to the original: ${text}`,
    undo: "↶ Undo",
  },

  unresolved: {
    title: (n: number) => `Unassigned: parts without a speaker (${n})`,
    lead: "Most are misheard silence. Click one to jump to it in the transcript.",
    named: (n: number) => `${n} named`,
    confirmTip: "Confirm the named parts and remove them from this list",
    confirm: "Confirm and remove",
    jumpTip: "Jump to this part and enter a name",
    arrow: (name: string) => `→ ${name}`,
    none: "Nothing left.",
  },

  nameMenu: {
    aria: "Choose the speaker for this line",
    heading: (time: string) => `Choose the speaker for this line (${time})`,
    labelName: "Label's name",
    typedHere: "Entered here",
    selected: "Selected",
    otherPlaceholder: "Enter another name",
    keys: (mod: string) => `${mod} + Enter to choose · Esc to close`,
    backToNoName: "Reset to unnamed",
    backToLabel: (name: string) => `Reset to the label's name (${name})`,
  },

  save: {
    saveTo: "Save to",
    change: "Change",
    saved: (n: number) => `Saved (${n} ${plural(n, "file", "files")})`,
    saving: "Saving…",
    save: "Save",
  },

  detail: {
    title: "Details",
    talkTitle: "Talk time by speaker",
    fixNames: "Edit names",
    fixNameOf: (name: string) => `Edit the name of ${name}`,
    share: (pct: number, min: number) => `${pct}% · ${min} min`,
    textTitle: "Transcript",
    rowsChars: "Lines / characters",
    rowsCharsValue: (rows: string, chars: string) => `${rows} lines · ${chars} characters`,
    speakers: "Speakers",
    speakersValue: (people: number, labels: number) => `${people} (from ${labels} ${plural(labels, "label", "labels")})`,
    overlaps: "Overlapping voices (*)",
    overlapsValue: (n: string) => n,
    editsTitle: "Edits",
    editedRows: "Lines with edited text",
    renamedRows: "Lines renamed individually",
    rowsValue: (n: string) => n,
    pending: "Unassigned left",
    pendingValue: (pending: string, confirmed: string) => `${pending} (${confirmed} confirmed)`,
  },

  done: {
    titleSaved: "Transcript saved",
    titleDone: "Transcript finished",
    lead: "You can transcribe another recording or quit Kikiwake.",
    notSavedFiles: "Not saved",
    unsavedTitle: "You have edits not saved to a file",
    unsavedBody:
      "Your edits (line names, confirmations, and text) are kept in History and come back when you reopen it. To keep a file, go back with “← Back to transcript” and save.",
    notSavedTitle: "Not saved yet",
    notSavedBody: (named: boolean) =>
      `Even without saving, this result stays in History (open it from “History” on the file screen${named ? ", with the names you entered" : ""}). To keep a file, go back with “← Back to transcript” and save it.`,
    another: "Transcribe another recording",
    quit: "Quit Kikiwake",
  },

  dialog: {
    cancelTitle: "Stop processing?",
    cancelKeep: "Continue",
    cancelConfirm: "Stop",
    cancelBodyKept: "The speaker detection results will be kept. Trying again reuses them and starts from transcription.",
    cancelBodyNotKept: "Speaker detection hasn't finished, so trying again starts from the beginning.",
    closeTitle: "Processing is running. Close anyway?",
    closeKeep: "Keep processing",
    closeConfirm: "Close",
    closeBody: "Closing stops processing. If speaker detection has finished, its results are kept and you can continue from History.",
    stay: "Cancel",
    revertTitle: "Revert all text?",
    revertConfirm: "Revert",
    revertBody: (n: number) => `The ${n} edited ${plural(n, "line goes", "lines go")} back to the original transcription. Names won't change.`,
    overwriteTitle: "Files with the same name exist",
    overwriteConfirm: "Replace",
    overwriteBody: (files: string) =>
      `The save location already has files with the same name (${files}). If you replace them, the old files can't be recovered.`,
  },

  toast: {
    reverted: "Reverted to the original text",
    confirmed: (n: number) => `Confirmed ${n}`,
    copied: "Copied the error details",
    deleted: "Deleted from history",
    relinked: "Linked to the file again",
  },

  engine: {
    stage: (stage: Stage) =>
      ({ extract: "Extracting audio", diarize: "Detecting speakers", transcribe: "Transcribing", merge: "Matching text to speakers" })[stage],
    error: (e: AppError) => {
      if (e.code === "disk_full") {
        const m = /約(\d+)GB/.exec(e.message);
        return m ? `Not enough free space. About ${m[1]} GB more is needed.` : "Not enough free space.";
      }
      if (e.code === "cancelled") {
        return e.message.includes("残して") ? "Stopped. The speaker detection results were kept, so trying again continues from there." : "Stopped.";
      }
      return ERRORS[e.code] ?? e.message;
    },
    envMessage: (item: EnvironmentItem) => ENVIRONMENT[item.message] ?? item.message,
    gpuName: (name: string) => name.replace(/（(\d+)コア）$/, " ($1-core)"),
    modelLabel: (id: ModelId, label: string) => MODEL_LABEL[id] ?? label,
    speakerLabel: (label: string) => {
      const m = /^話者([A-Z]+)$/.exec(label);
      if (m) return `Speaker ${m[1]}`;
      return label === "不明" ? "Unknown" : label;
    },
    hintKind: (kind: string) => HINT_KIND[kind] ?? kind,
    repeat: (n: RepeatNotice) => `The transcript from ${hms(n.startSec)} to ${hms(n.endSec)} repeats the same sentence and can't be read.`,
  },
};
