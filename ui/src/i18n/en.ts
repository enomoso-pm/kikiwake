// 画面の文字（英語）。形は ja.ts と同じ（Messages）。用語は ja.ts の頭の決まりに合わせる
// （transcript / voice separation / speaker / name / Unassigned（保存したファイルの見出しと同じ）/ edits / Stopped → Resume）。
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
  engine_failed: "Something went wrong during transcription. Please try again. If it keeps happening, copy the details and let us know.",
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
    "Enough for now, but transcribing several long recordings may run out of space.",
  モデルと作業用に足りています: "Enough for the models and working files",
  使えます: "Available",
  "使えません。時間がかかります。": "Not available. Processing will take longer.",
};

const MODEL_LABEL: Partial<Record<ModelId, string>> = {
  "whisper-large-v3": "speech to text",
  "nemotron-3-diarization": "voice separation",
};

const HINT_KIND: Record<string, string> = { 自己紹介: "self-intro", 呼びかけ直後: "addressed" };

export const en: Messages = {
  lang: {
    label: "Display language",
  },

  common: {
    noName: "Unassigned",
    copyDetail: "Copy details",
    play: "▶ Play",
    stop: "■ Stop",
    close: "Close",
    reveal: (isMac: boolean) => (isMac ? "Show in Finder" : "Show in File Explorer"),
    listSep: ", ",
    labels: (labels: string[]) => labels.join(", "),
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
      "Transcription runs entirely on this computer, so Kikiwake checks that it has enough performance and free space. You can't continue if any item is “Not met”. You can continue with “Caution”, but transcription may take longer or stop partway.",
    envLabel: { os: "OS", cpu: "Chip", memory: "Memory", disk: "Free space", gpu: "GPU" },
    level: { ok: "OK", warn: "Caution", error: "Not met" },
    blocked: "Some requirements aren't met, so you can't continue.",
    modelsTitle: "Download the AI models (first time only)",
    modelsLead: (total: string) =>
      `The models total ${total}, which can take tens of minutes depending on your connection. If you pause, the download picks up where it left off. Stay online until it finishes.`,
    modelRole: { "nemotron-3-diarization": "Voice separation", "whisper-large-v3": "Speech-to-text" },
    modelTitle: (role: string, _label: string) => `${role} model`,
    status: {
      missing: "Not downloaded yet",
      downloading: (bytes: string, pct: number) => `Downloading ${bytes} (${pct}%)`,
      partial: (bytes: string) => `Paused at ${bytes} — you can resume`,
      verifying: "Verifying — checking that the downloaded files aren't corrupted",
      ready: "Downloaded",
      error: (bytes: string) => `Failed at ${bytes} — you can resume`,
    },
    next: "Get started",
    resume: "Resume download",
    download: (total: string) => `Download (${total} total)`,
    pause: "Pause",
    reviewTitle: "AI models & requirements",
    reviewLead: "The AI models used for transcription, and whether this computer can run them. Your recordings and transcripts never leave this computer.",
    reviewModelsTitle: "AI models",
    recheck: "Check again",
    checking: "Checking…",
  },

  file: {
    dropHere: "Drag a recording here",
    or: "or",
    pick: "Choose file",
    formats: "Supported formats: mp4, mov, m4a (Voice Memos), mp3, wav",
    japaneseOnly: "Transcription currently supports Japanese recordings only.",
    another: "Choose another file",
    meta: (clock: string, size: string, format: string) => `${clock} · ${size} · ${format}`,
    reuseResultTitle: "Using the previous transcript",
    reuseResultBody: "It won't be transcribed again—you can name the speakers right away. Names you entered last time are filled in.",
    reuseDiarTitle: "Using the previous voice separation",
    reuseDiarBody: "The previous voice separation is reused, and it starts from converting speech to text.",
    processedOn: (day: string) => `This recording was transcribed on ${day}. `,
    processedBefore: "This recording was transcribed before. ",
    estimate: "Estimated time",
    soon: "Just a few seconds",
    start: "Start transcription",
  },

  /** Recording-first layout (2026-09-27): the list of recordings on the left, the chosen recording on the right. Same shape as ja.ts */
  objects: {
    brand: "Kikiwake",
    newRecording: "New recording",
    newTitle: "New recording",
    listTitle: "Recordings",
    listCount: (n: number) => String(n),
    listAria: "Recordings",
    empty: "Nothing yet. Choose a file under “New recording” and it will appear here.",
    settings: "AI models & requirements",
    collapse: "Hide the list",
    expand: "Show the recordings",
    status: {
      queued: (position: number) => (position > 1 ? `Queued (#${position})` : "Queued (next)"),
      running: (percent: number | null) => (percent === null ? "Transcribing" : `Transcribing ${percent}%`),
      stopped: "Stopped",
      notSaved: "Not saved yet",
      saved: "Saved",
      editedAfterSave: "Edited since saving",
    },
    meta: (parts: string[]) => parts.join(" · "),
    speakers: (n: number, named: boolean) => `${n} ${plural(n, "speaker", "speakers")} · ${named ? "named" : "no names"}`,
    people: (shown: string[], rest: number) => (rest > 0 ? `${shown.join(", ")} + ${rest} more` : shown.join(", ")),
    processedOn: (day: string) => `Transcribed ${day}`,
    fresh: "Finished transcribing (not opened yet)",
    source: {
      missing: "Original file not found",
      changed: "Original file has changed",
      missingBody: "The transcript, names, and edits are kept; only playing lines is unavailable. If you moved or renamed the file, choose it again to play.",
      missingVolume: (volume: string) => `It was on the external drive “${volume}”. Connect it and open this recording again to play.`,
      changedBody:
        "The transcript is still readable. If the length is the same (e.g., only the volume changed), relink to play lines; if you trimmed or joined it, the times no longer match, so transcribe it as a new recording.",
      unfinishedMissing: "The original file can't be found, so it can't resume.",
      unfinishedChanged: "The original file has changed, so it can't resume. Transcribe it as a new recording.",
      relinkSame: "Relink to this file",
      relinkPick: "Choose the file again",
      retranscribe: "Transcribe as a new recording",
    },
    tabs: { aria: "Recording", speakers: "Speakers", transcript: "Transcript" },
    more: "More actions",
    menu: {
      revealSaved: (isMac: boolean) => (isMac ? "Show saved files in Finder" : "Show saved files in File Explorer"),
      revealSource: (isMac: boolean) => (isMac ? "Show original file in Finder" : "Show original file in File Explorer"),
      relink: "Choose the original file again",
      cancel: "Stop transcribing",
      dequeue: "Remove from queue",
      delete: "Remove from list…",
    },
    stoppedTitle: "Stopped",
    resume: "Resume",
    enqueue: "Add to queue",
    queuedTitle: "Queued",
    queuedBody: (name: string) =>
      `Starts automatically when “${name}” finishes transcribing. If you quit the app while waiting, the queue is discarded (nothing has started yet, so no original files or transcripts are lost).`,
    queueNote: (name: string) => `“${name}” is being transcribed now. Starting adds this to the queue, and it begins automatically when that finishes.`,
    queuedToast: "Added to the queue",
    alreadyQueued: "This recording is already being transcribed or queued",
    doneToast: (name: string) => `“${name}” is transcribed`,
    failedToast: (name: string) => `Transcribing “${name}” stopped`,
    startFailed: (name: string, why: string) => `Couldn't start “${name}”: ${why}`,
    changedFileTitle: "You've transcribed a recording at this location before",
    changedFileBody: (day: string) =>
      `The file has changed since it was transcribed on ${day}. It will be transcribed as a new recording, and the earlier transcript stays in the list.`,
    opening: "Opening…",
    savedMissingTitle: "Saved files not found",
    savedMissingBody: "They may have been moved or deleted. The transcript and your edits are still on this Mac, so saving again recreates them.",
    toTranscript: "Open the transcript",
    dismiss: "Close",
    deleteTitle: "Remove from the list?",
    deleteBody: (name: string) =>
      `The transcript, names, and edits for “${name}” will be deleted from this Mac. The original file and any files you saved won't be deleted. This can't be undone.`,
    deletedToast: "Removed from the list",
    dropTitle: "Drop to add it as a new recording",
    /** Stopped recordings, playback without the original file, and the delete button (moved from the old History screen, 2026-09-27) */
    unfinishedDiar: "Voice separation is done",
    unfinishedNone: "Stopped before voice separation",
    playDisabled: "Can't play because the original file can't be found",
    deleteConfirm: "Delete",
  },

  /** New version notice (contract v10, 2026-09-27). Not installed automatically. Same shape as ja.ts */
  update: {
    band: (version: string) => `A new version (${version}) is available`,
    bandSub: "Check the steps, then replace the app when it suits you. Kikiwake never updates itself.",
    show: "What's new and how to update",
    skip: "Don't remind me about this version",
    title: (title: string) => `${title} is available`,
    published: (day: string) => `Released ${day}`,
    current: (version: string) => `You have ${version}`,
    notesTitle: "What's new",
    notesEmpty: "See the release page for what's new.",
    stepsTitle: "How to update",
    steps: (version: string) => [
      `Click “Open release page” and download “Kikiwake_${version}_aarch64.dmg”.`,
      "Quit Kikiwake (⌘Q).",
      "Open the .dmg and drag “Kikiwake” to Applications to replace the old one (click “Replace” if asked).",
      "Open Kikiwake. If a warning says it can't be opened, click “Done” (don't click “Move to Trash”).",
      "Go to Apple menu → System Settings → Privacy & Security, scroll down, click “Open Anyway”, and enter your password.",
      "In the confirmation that appears, click “Open Anyway”. The new version starts.",
    ],
    macos14: "On macOS 14, instead of steps 4–6: in Finder, right-click Kikiwake → Open, then click Open again.",
    note: "The warning appears because Kikiwake isn't registered with Apple's paid developer program; the app isn't damaged. Your transcripts (the list of recordings) and AI models stay as they are.",
    later: "Later",
    open: "Open release page",
    settingTitle: "New versions",
    settingLabel: "Check for a new version at launch",
    settingNote:
      "Kikiwake only asks GitHub for the latest version number; no recordings or text are sent (GitHub sees your IP address and your Kikiwake version). When this is off, Kikiwake doesn't ask and won't tell you about new versions.",
  },

  processing: {
    title: { running: "Transcribing", done: "Finished", cancelled: "Canceled", failed: "Stopped" },
    subTranscribe: "This step takes most of the time",
    subReused: "Using the previous voice separation",
    reused: "Used previous result",
    done: "Done",
    waiting: "Waiting",
    cancelled: "Stopped",
    failed: "Failed",
    inProgress: "In progress",
    almostDone: "Almost done",
    calculating: "Estimating time left",
    elapsed: (clock: string) => `Elapsed ${clock}`,
    kept: "The voice separation results were kept. Resuming uses them and starts from converting speech to text.",
    notKept: "Voice separation hadn't finished yet. Resuming starts from the beginning.",
    local: "Transcription happens only on this computer.",
    cancel: "Stop",
    retry: "Resume",
  },

  naming: {
    lead: "Listen to each voice and enter who it is. Speakers with the same name are merged into one person. Speakers left blank are saved as “Speaker A” and so on.",
    warning: {
      short_talk: "This speaker says very little. It may be fragments of someone else's voice.",
      mixed_voices: "Two people's voices may be mixed in this speaker.",
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
    source: (kind: string, n: number) => `${kind} ×${n}`,
    sourceSep: ", ",
    hint: (name: string, sources: string) => `${name} (${sources})`,
  },

  result: {
    details: "Details",
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
    confirmTip: "Move the named parts into the transcript and remove them from this list",
    confirm: "Move to transcript",
    jumpTip: "Jump to this part and enter a name",
    arrow: (name: string) => `→ ${name}`,
    none: "Nothing left.",
  },

  nameMenu: {
    aria: "Choose the speaker for this line",
    heading: (time: string) => `Choose the speaker for this line (${time})`,
    labelName: "Speaker's name",
    typedHere: "Entered here",
    selected: "Selected",
    otherPlaceholder: "Enter another name",
    keys: (mod: string) => `${mod} + Enter to choose · Esc to close`,
    backToNoName: "Reset to Unassigned",
    backToLabel: (name: string) => `Reset to the speaker's name (${name})`,
  },

  save: {
    saveTo: "Save to",
    change: "Change folder",
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
    speakersValue: (people: number, labels: number) => `${people} (from ${labels} ${plural(labels, "speaker", "speakers")})`,
    overlaps: "Overlapping voices (*)",
    overlapsValue: (n: string) => n,
    editsTitle: "Edits",
    editedRows: "Lines with edited text",
    renamedRows: "Lines renamed individually",
    rowsValue: (n: string) => n,
    pending: "Unassigned left",
    pendingValue: (pending: string, confirmed: string) => `${pending} (${confirmed} moved to the transcript)`,
  },

  dialog: {
    cancelTitle: "Stop transcribing?",
    cancelKeep: "Continue",
    cancelConfirm: "Stop",
    cancelBodyKept: "The voice separation results will be kept. Resuming uses them and starts from converting speech to text.",
    cancelBodyNotKept: "Voice separation hasn't finished, so resuming starts from the beginning.",
    closeTitle: "Transcription is running. Close anyway?",
    closeKeep: "Keep transcribing",
    closeConfirm: "Close",
    closeBody: {
      beforeSeparation: (name: string) => `Closing stops transcribing “${name}” and discards the progress so far. Resuming starts over from the beginning.`,
      converting: (name: string) =>
        `Closing stops transcribing “${name}”. The voice separation results are kept, but the speech-to-text in progress is discarded, and resuming redoes converting speech to text from the start (for recordings over 90 minutes, the parts finished in roughly one-hour sections are kept).`,
      finishing: (name: string) => `Closing stops transcribing “${name}”. The voice separation and the text are kept, and resuming finishes right away.`,
      queue: (n: number) =>
        `The ${n} queued ${plural(n, "recording is", "recordings are")} discarded. ${n === 1 ? "It hasn't" : "They haven't"} started yet, so no original files or transcripts are lost.`,
    },
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
    confirmed: (n: number) => `Moved ${n} to the transcript`,
    copied: "Copied the error details",
    relinked: "Linked to the file again",
  },

  engine: {
    stage: (stage: Stage) =>
      ({ extract: "Extracting audio", diarize: "Separating voices", transcribe: "Converting speech to text", merge: "Putting it together" })[stage],
    error: (e: AppError) => {
      if (e.code === "disk_full") {
        const m = /約(\d+)GB/.exec(e.message);
        return m ? `Not enough free space. About ${m[1]} GB more is needed.` : "Not enough free space.";
      }
      if (e.code === "cancelled") {
        return e.message.includes("残して") ? "Canceled. The voice separation results were kept, so resuming continues from there." : "Canceled.";
      }
      return ERRORS[e.code] ?? e.message;
    },
    envMessage: (item: EnvironmentItem) => ENVIRONMENT[item.message] ?? item.message,
    gpuName: (name: string) => name.replace(/（(\d+)コア）$/, " ($1-core)"),
    modelLabel: (id: ModelId, label: string) => MODEL_LABEL[id] ?? label,
    speakerLabel: (label: string) => {
      const m = /^話者([A-Z]+)$/.exec(label);
      if (m) return `Speaker ${m[1]}`;
      return label === "不明" ? "Unassigned" : label;
    },
    hintKind: (kind: string) => HINT_KIND[kind] ?? kind,
    repeat: (n: RepeatNotice) => `The transcript from ${hms(n.startSec)} to ${hms(n.endSec)} repeats the same sentence and can't be read.`,
  },
};
