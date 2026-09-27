// 画面の文字（日本語）。この形が辞書の正で、ほかの言語（en.ts など）はこの形に合わせる（形が違えば型チェックで止まる）。
// 値は文字、または引数から文字を作る関数。エンジン（Rust）が日本語で返す文は engine の関数で今の言語にする（日本語ではそのまま）
import type { AppError, EnvironmentItem, ModelId, RepeatNotice, SpeakerWarning, Stage } from "@contract/types";

export const ja = {
  lang: {
    /** 言語の切り替えの名前（読み上げと、指したときの説明） */
    label: "表示の言語",
  },

  common: {
    /** 名前の無い行（確認用で名前を入れていない） */
    noName: "名無し",
    copyDetail: "詳細をコピー",
    play: "▶ 再生",
    stop: "■ 停止",
    close: "閉じる",
    backToTranscript: "← 文字起こしに戻る",
    reveal: (isMac: boolean): string => (isMac ? "Finder で表示" : "エクスプローラーで表示"),
    /** 並べるときの区切り（名前・ラベル・ファイル） */
    listSep: "・",
    /** 「話者A」などのラベルを並べるとき */
    labels: (labels: string[]) => labels.join("・"),
  },

  step: {
    aria: "工程",
    file: "ファイル",
    processing: "処理",
    naming: "名前付け",
    result: "結果",
    pickAnother: "別の録音を選ぶ",
    moveTo: (label: string) => `${label}へ移る`,
  },

  time: {
    minutes: (min: number) => `${min}分`,
    hours: (h: number) => `${h}時間`,
    hoursMinutes: (h: number, m: number) => `${h}時間${m}分`,
    remaining: (t: string) => `残り 約${t}`,
    aboutMinutes: (a: number) => `約 ${a} 分`,
    aboutMinutesRange: (a: number, b: number) => `約 ${a}〜${b} 分`,
    about: (t: string) => `約 ${t}`,
    aboutRange: (a: string, b: string) => `約 ${a}〜${b}`,
    monthDay: (month: number, day: number) => `${month}月${day}日`,
    voiceMemo: "m4a（ボイスメモ）",
  },

  setup: {
    title: "はじめに準備をします",
    lead: "この PC で動くかを確かめ、文字起こしに使う AI モデルをダウンロードします。ダウンロードは初回だけで、その後はネットにつながなくても動きます。録音と文字起こしは、この PC の外に出しません。",
    envTitle: "動作条件",
    envLead:
      "文字起こしはこの PC の力だけで行うため、処理に足りる性能と空き容量があるかを確かめています。「不可」が1つでもあると進めません。「注意」は進めますが、時間がかかったり途中で止まったりすることがあります。",
    envLabel: { os: "OS", cpu: "チップ", memory: "メモリ", disk: "空き容量", gpu: "GPU" } as Record<EnvironmentItem["id"], string>,
    level: { ok: "問題なし", warn: "注意", error: "不可" } as Record<EnvironmentItem["level"], string>,
    blocked: "動作条件を満たしていない項目があるため、先に進めません。",
    modelsTitle: "AI モデルのダウンロード（初回のみ）",
    modelsLead: (total: string) =>
      `合計 ${total} あり、回線によっては数十分かかります。途中で中断しても、次は続きから再開できます。終わるまでネットにつないだままにしてください。`,
    modelRole: { "nemotron-3-diarization": "声を聞き分ける", "whisper-large-v3": "声を文字にする" } as Partial<Record<ModelId, string>>,
    modelTitle: (role: string, label: string) => `${role}（${label}モデル）`,
    status: {
      missing: "まだダウンロードしていません",
      downloading: (bytes: string, pct: number) => `ダウンロード中　${bytes}（${pct}%）`,
      partial: (bytes: string) => `中断中　${bytes}　— 続きから再開できます`,
      verifying: "確認中　ダウンロードしたファイルが壊れていないか確かめています",
      ready: "ダウンロード済み",
      error: (bytes: string) => `失敗　${bytes}　— 続きから再開できます`,
    },
    next: "次へ",
    resume: "続きからダウンロードする",
    download: (total: string) => `ダウンロードする（合計 ${total}）`,
    pause: "中断",
  },

  file: {
    title: "録音を選ぶ",
    dropHere: "録音をここにドラッグ",
    or: "または",
    pick: "ファイルを選ぶ",
    formats: "対応形式：mp4・mov・m4a（ボイスメモ）・mp3・wav",
    /** 書き起こしが日本語だけであることの断り。日本語の画面では出さない（空） */
    japaneseOnly: "",
    another: "別のファイルにする",
    meta: (clock: string, size: string, format: string) => `${clock} ・ ${size} ・ ${format}`,
    reuseResultTitle: "前回の結果を使います",
    reuseResultBody: "書き起こしをやり直さずに、すぐに名前付けへ進みます。前回名前を付けていれば、その名前が入っています。",
    reuseDiarTitle: "前回の話者判定を使います",
    reuseDiarBody: "話者の判定は前回の結果をそのまま使い、書き起こしから始めます。",
    processedOn: (day: string) => `この録音は ${day} に一度処理しています。`,
    processedBefore: "この録音は一度処理しています。",
    estimate: "所要時間の目安",
    soon: "すぐに終わります",
    start: "文字起こしを始める",
  },

  /** 履歴（2026-09-27 決定。ファイルの画面から入る。仕様書に無い） */
  history: {
    /** ファイルの画面の入口 */
    open: "履歴",
    openTitle: "前に文字起こしした録音を開く",
    back: "← 録音を選ぶ",
    title: "履歴",
    lead: "前に文字起こしした録音です。開くと、閉じたときの画面（名前付け・結果）に戻ります。途中のものは続きから処理します。",
    empty: "まだありません。録音を文字起こしすると、ここに並びます。",
    meta: (parts: string[]) => parts.join(" ・ "),
    speakers: (n: number) => `話者 ${n}`,
    unfinished: "途中",
    unfinishedDiar: "話者の判定まで済んでいます",
    unfinishedNone: "話者の判定の前に止まりました",
    named: "名前あり",
    unsaved: "保存していない手直しあり",
    /** 元ファイルが無い録音の一言（途中のものは続きから処理できない） */
    missing: (unfinished: boolean): string =>
      unfinished ? "元のファイルが見つからないので、続きから処理できません。" : "元のファイルが見つかりません。書き起こしは読めますが、再生はできません。",
    openItem: "開く",
    resume: "続きから",
    opening: "開いています…",
    delete: "消す",
    deleteTitle: "履歴から消しますか？",
    deleteBody: (name: string) =>
      `「${name}」の書き起こし・名前・手直しを、この Mac の履歴から消します。元の録音と、保存した文字起こしのファイルは消えません。消したものは元に戻せません。`,
    deleteConfirm: "消す",
    /** 結果の画面: 元ファイルが無い録音を開いたとき */
    missingBand: "元のファイルが見つかりません。書き起こしは読めますが、行の再生はできません。ファイルを移した場合は、選び直すと再生できます。",
    relink: "ファイルを選び直す",
    playDisabled: "元のファイルが見つからないので再生できません",
  },

  processing: {
    title: { running: "文字起こし中", done: "完了しました", cancelled: "中止しました", failed: "途中で止まりました" } as Record<
      "running" | "done" | "cancelled" | "failed",
      string
    >,
    subTranscribe: "時間のほとんどはこの段階です",
    subReused: "前回の話者判定を使い回します",
    reused: "前回の結果を使用",
    done: "完了",
    waiting: "待ち",
    cancelled: "中止",
    failed: "失敗",
    inProgress: "進行中",
    almostDone: "まもなく終わります",
    calculating: "残り時間を計算中",
    elapsed: (clock: string) => `経過 ${clock}`,
    kept: "話者の判定の結果は残っています。やり直すと、それを使って書き起こしから始めます。",
    notKept: "話者の判定はまだ終わっていませんでした。やり直すと最初から始めます。",
    local: "処理はこの PC の中だけで行っています。",
    cancel: "中止",
    back: "ファイル選択に戻る",
    retry: "やり直す",
  },

  naming: {
    title: "話者に名前を付ける",
    lead: "声を聞いて、誰の声か名前を入れてください。同じ名前を付けたラベルは1人にまとまります。名前を空けたラベルは「話者A」などのまま残ります。",
    warning: {
      short_talk: "発言がとても短いラベルです。他の人の声の断片かもしれません。",
      mixed_voices: "2人の声が混ざっている可能性があります。",
    } as Record<SpeakerWarning, string>,
    /** サンプルの位置（1・2・3） */
    position: (index: number) => ({ 1: "序盤", 2: "中盤", 3: "終盤" } as Record<number, string>)[index] ?? "",
    insertTitle: "入力欄に入れる",
    merged: "（まとめ）",
    noName: "名前なし",
    hasWarning: "注意あり",
    talkTime: "発言時間",
    utterances: "発話",
    times: (n: number) => `${n}回`,
    firstSeen: "初登場",
    nameLabel: "名前",
    placeholder: (label: string) => `空けると「${label}」のまま`,
    insert: (name: string) => `${name} を入れる`,
    clue: "名前の手がかり：",
    clueNone: "見つかりませんでした",
    mergeNote: (name: string, labels: string) => `「${name}」として ${labels} を1人にまとめます`,
    noSamples: "聞けるサンプルがありません",
    hintsTitle: "話者を決められなかった部分の名前の手がかり",
    hintsLead: "録音の序盤など、誰の声か決めきれなかった部分で名乗っていた名前です。声を聞いて、どの話者の声か見比べてください。",
    insertInto: (name: string, label: string) => `${name} を${label} に入れる`,
    prev: "前の話者",
    next: "次の話者",
    applying: "まとめています…",
    backToResult: "文字起こしに戻る →",
    showResult: "文字起こしを見る →",
    /** 下の帯の1行目: 「4つのラベル → 4人として保存（話者A＋話者B → 松本）」 */
    labelCount: (n: number) => (n < 10 ? `${n}つのラベル` : `${n}個のラベル`),
    saveAs: (labels: string, people: number) => `${labels} → ${people}人として保存`,
    mergedItem: (labels: string[], name: string) => `${labels.join("＋")} → ${name}`,
    mergedList: (items: string[]) => `（${items.join("、")}）`,
    /** 下の帯の2行目 */
    unnamed: (labels: string) => `名前なし：${labels}（そのまま残ります）`,
    allNamed: "すべてのラベルに名前が付いています",
    /** 手がかりの出どころ: 「自己紹介2」。並べるときは sourceSep でつなぐ */
    source: (kind: string, n: number) => `${kind}${n}`,
    sourceSep: "・",
    /** 名前の手がかり: 「田中（自己紹介2・呼びかけ直後1）」 */
    hint: (name: string, sources: string) => `${name}（${sources}）`,
  },

  result: {
    backToNaming: "← 名前付けに戻る",
    title: "文字起こし",
    meta: (file: string, clock: string, people: number, rows: string, chars: string) =>
      `${file} ・ ${clock} ・ ${people}人 ・ ${rows}行 ・ ${chars}字`,
    editableNote: "名前や、ラベルのまとめ方は、いつでも戻って直せます",
    details: "詳細",
    finish: "完了",
    searchPlaceholder: "本文を検索",
    matches: (current: number, total: number) => `${current} / ${total}件`,
    noMatches: "0件",
    prev: "前へ",
    next: "次へ",
    hint: "* は声の重なり ・ 名前も文字もダブルクリックで直せます",
    editedRows: (n: number) => `直した行 ${n}`,
    revertAll: "すべて元の文字に戻す",
    showPeople: "表示する人",
    showAll: "すべて表示",
    rows: (rows: string) => `${rows}行`,
    shownOf: (total: number, shown: number, rows: string) => `${total}人中${shown}人 ・ ${rows}行`,
    repeatTitle: "本文のこの箇所へ移る",
    repeatGo: "この箇所へ移る",
  },

  transcript: {
    nameTip: "ダブルクリックで名前を変える",
    nameTipOverridden: (label: string) => `この行だけ変更（元：${label}） ダブルクリックで変える`,
    playLine: "この発言を再生",
    stopLine: "停止",
    editKeys: (mod: string) => `${mod} + Enter で決定 ・ Esc でやめる`,
    editTip: "ダブルクリックで文字を直す",
    originalTip: (text: string) => `元の文字：${text}`,
    edited: "直した",
    undoTipPrev: (text: string) => `1つ前：${text}`,
    undoTipOriginal: (text: string) => `元の文字に戻る：${text}`,
    undo: "↶ 1つ戻す",
  },

  unresolved: {
    title: (n: number) => `確認用：話者を決められなかった部分（${n}）`,
    lead: "多くは無音の聞き違いです。押すと本文のその箇所へ移ります。",
    named: (n: number) => `名前を入れた ${n}件`,
    confirmTip: "名前を入れた部分を確定して、この一覧から外します",
    confirm: "確定して一覧から外す",
    jumpTip: "本文のこの箇所へ移って名前を入れる",
    arrow: (name: string) => `→ ${name}`,
    none: "残っていません。",
  },

  nameMenu: {
    aria: "この行の話者を選ぶ",
    heading: (time: string) => `この行の話者を選ぶ（${time}）`,
    labelName: "ラベルの名前",
    typedHere: "ここで入力",
    selected: "選択中",
    otherPlaceholder: "ほかの名前を入力",
    keys: (mod: string) => `${mod} + Enter で決定 ・ Esc で閉じる`,
    backToNoName: "名無しに戻す",
    backToLabel: (name: string) => `ラベルの名前に戻す（${name}）`,
  },

  save: {
    saveTo: "保存先",
    change: "変更",
    saved: (n: number) => `保存しました（${n}件）`,
    saving: "保存中…",
    save: "保存",
  },

  detail: {
    title: "詳細",
    talkTitle: "話者ごとの発言時間",
    fixNames: "名前を直す",
    fixNameOf: (name: string) => `${name} の名前を直す`,
    share: (pct: number, min: number) => `${pct}%　${min}分`,
    textTitle: "本文",
    rowsChars: "行数・字数",
    rowsCharsValue: (rows: string, chars: string) => `${rows}行 ・ ${chars}字`,
    speakers: "話者",
    speakersValue: (people: number, labels: number) => `${people}人（ラベル ${labels}個から）`,
    overlaps: "声の重なり（*）",
    overlapsValue: (n: string) => `${n}箇所`,
    editsTitle: "手直し",
    editedRows: "文字を直した行",
    renamedRows: "名前を個別に変えた行",
    rowsValue: (n: string) => `${n}行`,
    pending: "確認用の残り",
    pendingValue: (pending: string, confirmed: string) => `${pending}件（確定済み ${confirmed}件）`,
  },

  done: {
    titleSaved: "文字起こしを保存しました",
    titleDone: "文字起こしを終えました",
    lead: "続けて別の録音を文字起こしするか、Kikiwake を終了できます。",
    notSavedFiles: "保存していません",
    unsavedTitle: "ファイルに保存していない手直しがあります",
    unsavedBody:
      "直した内容（行の名前・確認用の確定・文字）は履歴に残っていて、開き直すと戻ります。ファイルに残すときは「← 文字起こしに戻る」から保存してください。",
    notSavedTitle: "まだ保存していません",
    notSavedBody: (named: boolean) =>
      `保存しなくても、この結果は履歴に残ります（ファイルの画面の「履歴」から開けます${named ? "。付けた名前も入っています" : ""}）。ファイルに残すときは「← 文字起こしに戻る」から保存してください。`,
    another: "別の録音を文字起こしする",
    quit: "Kikiwake を終了",
  },

  dialog: {
    cancelTitle: "処理を中止しますか？",
    cancelKeep: "続ける",
    cancelConfirm: "中止する",
    cancelBodyKept: "話者の判定の結果は残ります。やり直すときはそれを使い、書き起こしから始めます。",
    cancelBodyNotKept: "話者の判定はまだ終わっていないため、やり直すと最初から始めます。",
    closeTitle: "処理中です。閉じますか？",
    closeKeep: "処理を続ける",
    closeConfirm: "閉じる",
    closeBody: "閉じると処理が止まります。話者の判定が済んでいれば、その結果は残り、履歴から続きを再開できます。",
    stay: "やめる",
    revertTitle: "すべて元の文字に戻しますか？",
    revertConfirm: "元に戻す",
    revertBody: (n: number) => `直した ${n} 行を、書き起こしたときの文字に戻します。名前は変わりません。`,
    overwriteTitle: "同じ名前のファイルがあります",
    overwriteConfirm: "上書きする",
    overwriteBody: (files: string) => `保存先に同じ名前のファイルがあります（${files}）。上書きすると、前のファイルは元に戻せません。`,
  },

  toast: {
    reverted: "元の文字に戻しました",
    confirmed: (n: number) => `${n}件を確定しました`,
    copied: "エラーの詳細をコピーしました",
    deleted: "履歴から消しました",
    relinked: "元のファイルを選び直しました",
  },

  /** エンジン（Rust）が日本語で返すもの。日本語ではそのまま出す */
  engine: {
    stage: (stage: Stage) =>
      ({ extract: "音声の取り出し", diarize: "話者の判定", transcribe: "書き起こし", merge: "突き合わせ" })[stage],
    error: (e: AppError) => e.message,
    envMessage: (item: EnvironmentItem) => item.message,
    gpuName: (name: string) => name,
    modelLabel: (_id: ModelId, label: string) => label,
    /** 「話者A」「不明」などのラベル */
    speakerLabel: (label: string) => label,
    /** 手がかりの種類（「自己紹介」「呼びかけ直後」） */
    hintKind: (kind: string) => kind,
    repeat: (n: RepeatNotice) => n.message,
  },
};

export type Messages = typeof ja;
