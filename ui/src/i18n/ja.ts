// 画面の文字（日本語）。この形が辞書の正で、ほかの言語（en.ts など）はこの形に合わせる（形が違えば型チェックで止まる）。
// 値は文字、または引数から文字を作る関数。エンジン（Rust）が日本語で返す文は engine の関数で今の言語の画面の言葉にする。
//
// 用語（2026-09-27 に統一。同じものを別の言葉で呼ばない。ui/README.md の「言葉の決まり」）:
//   文字起こし（書き起こし・処理・結果とは言わない）／聞き分け（AI が声で分けること。話者の判定とは言わない）／
//   話者（話者A…。ラベルとは言わない）／名前（話者に付ける呼び名）／確認用（誰の声か決められなかった発言。保存したファイルの見出しと同じ）／
//   発言（しゃべった1回分）／手直し／中断 → 再開／処理の段階は「音声を取り出す・声を聞き分ける・声を文字にする・まとめる」／
//   「はじめる」はひらがな（動詞も。2026-09-27 決定）
import type { AppError, EnvironmentItem, ModelId, RepeatNotice, SpeakerWarning, Stage } from "@contract/types";

const pad2 = (n: number) => String(n).padStart(2, "0");
/** 繰り返しの知らせの時刻（エンジンと同じ h:mm:ss） */
const hms = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 3600)}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
};

/** エンジンのエラー（code ごと。画面の言葉にそろえた文。空き容量は数が入るのでエンジンの文のまま） */
const ERRORS: Record<string, string> = {
  file_not_found: "ファイルが見つかりません。移したり消したりしていないか確かめてください。",
  unsupported_format: "この形式には対応していません。対応している形式：mp4・mov・m4a・mp3・wav",
  no_audio_track: "このファイルには音声が入っていません。",
  model_missing: "AI モデルが見つかりません。はじめの準備からやり直してください。",
  network_unreachable: "AI モデルのダウンロード先（huggingface.co）に接続できません。ネットの接続を確かめてください。",
  download_failed: "ダウンロードが途中で中断しました。再開すると続きからダウンロードします。",
  checksum_mismatch: "ダウンロードしたファイルが壊れていました。もう一度ダウンロードしてください。",
  engine_failed: "文字起こしの途中で問題が起きました。もう一度実行してください。続く場合は詳細をコピーして連絡してください。",
  out_of_memory: "メモリが足りなくなりました。ほかのアプリを閉じてから、もう一度実行してください。",
  not_same_recording: "選んだファイルは、この録音と大きさか長さが違います。元のファイルを選んでください。",
  not_writable: "このフォルダには保存できません（書き込む許可がありません）。「保存…」の保存先で、別のフォルダを選んでください。",
  save_failed: "保存できませんでした。保存先を確かめて、もう一度保存してください。続く場合は詳細をコピーして連絡してください。",
  screens_unavailable: "この録画からは、画面の絵を取り出せませんでした（画面の共有が見つからない・映像を読めない）。",
  screens_source_missing: "マニュアルの素材を作るには、元の録画が要ります。元の録画を移したり消したりしていないか確かめてください。",
  screens_outdated:
    "画面の絵の選び方が、新しい版で変わりました。マニュアルの素材を作るには、「新しい録音」でこの録画を選び直し、「マニュアル用に、画面の絵も取り出す」にチェックを入れてはじめてください（文字起こしはやり直しません）。",
};

/** 動作条件の表示文（エンジンの文のうち、画面の言葉とずれるものだけ） */
const ENVIRONMENT: Record<string, string> = {
  "長い録音では、他のアプリを閉じてから実行してください。": "長い録音では、ほかのアプリを閉じてから実行してください。",
  "今は足ります。長い録音を続けて処理すると足りなくなることがあります。": "今は足ります。長い録音を続けて文字起こしすると、足りなくなることがあります。",
};

export const ja = {
  lang: {
    /** 言語の切り替えの名前（読み上げと、指したときの説明） */
    label: "表示の言語",
  },

  common: {
    /** 名前の無い行（確認用で名前を入れていない） */
    noName: "確認用",
    copyDetail: "詳細をコピー",
    play: "▶ 再生",
    stop: "■ 停止",
    close: "閉じる",
    reveal: (isMac: boolean): string => (isMac ? "Finder で表示" : "エクスプローラーで表示"),
    /** 並べるときの区切り（名前・話者・ファイル） */
    listSep: "・",
    /** 「話者A」などの話者を並べるとき */
    labels: (labels: string[]) => labels.join("・"),
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
      "文字起こしはこの PC の力だけで行うため、それに足りる性能と空き容量があるかを確かめています。「不可」が1つでもあると進めません。「注意」は進めますが、時間がかかったり、途中で中断したりすることがあります。",
    envLabel: { os: "OS", cpu: "チップ", memory: "メモリ", disk: "空き容量", gpu: "GPU" } as Record<EnvironmentItem["id"], string>,
    level: { ok: "問題なし", warn: "注意", error: "不可" } as Record<EnvironmentItem["level"], string>,
    blocked: "動作条件を満たしていない項目があるため、先に進めません。",
    modelsTitle: "AI モデルのダウンロード（初回のみ）",
    modelsLead: (total: string) =>
      `合計 ${total} あり、回線によっては数十分かかります。途中で中断しても、次は続きから再開できます。終わるまでネットにつないだままにしてください。`,
    modelRole: { "nemotron-3-diarization": "声を聞き分ける", "whisper-large-v3": "声を文字にする" } as Partial<Record<ModelId, string>>,
    modelTitle: (role: string, _label: string) => `${role}モデル`,
    status: {
      missing: "まだダウンロードしていません",
      downloading: (bytes: string, pct: number) => `ダウンロード中　${bytes}（${pct}%）`,
      partial: (bytes: string) => `中断中　${bytes}　— 続きから再開できます`,
      verifying: "確認中　ダウンロードしたファイルが壊れていないか確かめています",
      ready: "ダウンロード済み",
      error: (bytes: string) => `失敗　${bytes}　— 続きから再開できます`,
    },
    next: "はじめる",
    resume: "続きからダウンロードする",
    download: (total: string) => `ダウンロードする（合計 ${total}）`,
    pause: "中断",
    /** AI モデルがそろったあとに見返す画面（案A の「AI モデルと動作条件」。2026-09-27） */
    reviewTitle: "AI モデルと動作条件",
    reviewLead: "文字起こしに使う AI モデルと、この PC で動くかを確かめた結果です。録音と文字起こしは、この PC の外に出しません。",
    reviewModelsTitle: "AI モデル",
    recheck: "もう一度確かめる",
    checking: "確かめています…",
  },

  file: {
    dropHere: "録音をここにドラッグ",
    or: "または",
    pick: "ファイルを選ぶ",
    formats: "対応形式：mp4・mov・m4a（ボイスメモ）・mp3・wav",
    /** 文字起こしが日本語だけであることの断り。日本語の画面では出さない（空） */
    japaneseOnly: "",
    another: "別のファイルにする",
    meta: (clock: string, size: string, format: string) => `${clock} ・ ${size} ・ ${format}`,
    reuseResultTitle: "前回の文字起こしを使います",
    reuseResultBody: "文字起こしをやり直さずに、すぐに話者の名前を付けられます。前回付けた名前も入っています。",
    reuseDiarTitle: "前回の聞き分けを使います",
    reuseDiarBody: "声の聞き分けは前回の結果をそのまま使い、声を文字にするところからはじめます。",
    processedOn: (day: string) => `この録音は ${day} に一度文字起こししています。`,
    processedBefore: "この録音は一度文字起こししています。",
    estimate: "所要時間の目安",
    soon: "すぐに終わります",
    start: "文字起こしをはじめる",
    /** 版13: 録画（映像あり）のときだけ出す（2026-10-12 決定。初めは外れている） */
    screens: "マニュアル用に、画面の絵も取り出す",
    screensHint:
      "画面共有の録画から、場面ごとの画面の絵を取り出します。保存のときに、文字起こしと絵をまとめた zip（AI に渡す説明つき）を書き出せます。カメラに映った人は黒く塗ります。",
  },

  /**
   * 録音が主役の画面（案A。2026-09-27 に製品の画面にした）。左に録音の一覧、右に選んだ録音（「話者」「文字起こし」の切り替え）。
   * 前の形（工程バー・履歴の画面・完了の画面）は 2026-09-27 に消した。処理中に足した録音は順番待ち（2026-09-27 決定）
   */
  objects: {
    brand: "Kikiwake",
    newRecording: "新しい録音",
    newTitle: "新しい録音",
    listTitle: "録音",
    listCount: (n: number) => `${n}件`,
    listAria: "録音の一覧",
    empty: "まだありません。「新しい録音」から録音を選ぶと、ここに並びます。",
    settings: "AI モデルと動作条件",
    collapse: "一覧をしまう",
    expand: "録音の一覧を出す",
    /** 状態の印（2026-09-27 決定: 保存を軸にした6つ。名前は付けなくても保存できるので、名前の有無は印にしない） */
    status: {
      queued: (position: number) => (position > 1 ? `順番待ち（${position}番目）` : "順番待ち（次）"),
      running: (percent: number | null) => (percent === null ? "文字起こし中" : `文字起こし中 ${percent}%`),
      stopped: "中断",
      notSaved: "保存前",
      saved: "保存済み",
      editedAfterSave: "保存後に手直し",
    },
    meta: (parts: string[]) => parts.join(" ・ "),
    /** 話者の数と、名前が付いているか（印ではなく録音の情報として出す） */
    speakers: (n: number, named: boolean) => `話者 ${n}・${named ? "名前あり" : "名前なし"}`,
    /** 名前を付けた録音の一覧の行（約束 版9 の namedSpeakers。2026-09-27 決定）: 発言の多い順に2人と、残りの人数（名前なしも数える） */
    people: (shown: string[], rest: number) => (rest > 0 ? `${shown.join("・")}ほか${rest}人` : shown.join("・")),
    processedOn: (day: string) => `${day}に文字起こし`,
    /** 見ていない間に文字起こしが終わり、まだ開いていない録音の「●」 */
    fresh: "文字起こしが終わりました（まだ開いていません）",
    source: {
      missing: "元のファイルが見つかりません",
      changed: "元のファイルが変わっています",
      missingBody: "文字起こし・名前・手直しは残っていて、発言の再生だけできません。移した・名前を変えたなら、選び直すと再生できます。",
      missingVolume: (volume: string) => `外付けのドライブ「${volume}」にあったファイルです。つないでから開き直すと再生できます。`,
      changedBody:
        "文字起こしはそのまま読めます。音量を変えただけなど長さが同じなら結び直すと再生でき、切った・つないだなら時刻がずれるので新しい録音として文字起こしします。",
      unfinishedMissing: "元のファイルが見つからないので、再開できません。",
      unfinishedChanged: "元のファイルが変わったので、再開できません。新しい録音として文字起こししてください。",
      relinkSame: "このファイルで結び直す",
      relinkPick: "ファイルを選び直す",
      retranscribe: "新しい録音として文字起こしする",
    },
    tabs: { aria: "録音の中身", speakers: "話者", transcript: "文字起こし" },
    /**
     * 左の一覧の行の「…」（2026-09-29 の2回目: ごみ箱から「…」に。中は「Finder で表示」（保存したファイル）と「削除…」。
     * 「履歴に3点リーダーを出して、そこで Finder で表示と削除」という要望から）
     */
    rowMenu: "その他の操作",
    rowMenuAria: (name: string) => `「${name}」のその他の操作`,
    /** 一度も保存していない録音では「Finder で表示」を押せない。その下に出す一言 */
    notSavedYet: "まだ保存していません",
    /** 2026-09-29: 「一覧から消す…」→「削除…」（「一覧」は画面のどこにも出てこない言葉だったため。案3つから選んだ）。何が残るかは確かめの画面で */
    remove: "削除…",
    dequeue: "順番待ちから外す",
    stoppedTitle: "中断しています",
    resume: "再開する",
    enqueue: "順番待ちに入れる",
    queuedTitle: "順番待ち",
    queuedBody: (name: string) =>
      `「${name}」の文字起こしが終わったら、自動ではじめます。順番待ちのままアプリを閉じると、順番待ちは破棄します（まだはじめていないので、元のファイルも文字起こしも失いません）。`,
    queueNote: (name: string) => `今は「${name}」を文字起こししています。はじめると順番待ちに入り、終わったら自動ではじまります。`,
    queuedToast: "順番待ちに入れました",
    alreadyQueued: "この録音は、文字起こし中か順番待ちです",
    doneToast: (name: string) => `「${name}」の文字起こしが終わりました`,
    failedToast: (name: string) => `「${name}」の文字起こしが中断しました`,
    startFailed: (name: string, why: string) => `「${name}」をはじめられませんでした：${why}`,
    changedFileTitle: "この場所の録音は、前に文字起こししています",
    changedFileBody: (day: string) =>
      `${day}に文字起こししたあとで、ファイルが変わっています。新しい録音として文字起こしし、前の文字起こしは一覧に残ります。`,
    opening: "開いています…",
    savedMissingTitle: "保存したファイルが見つかりません",
    savedMissingBody: "移したか消した可能性があります。文字起こしと手直しはこの Mac に残っているので、もう一度保存すると作り直せます。",
    toTranscript: "文字起こしを開く",
    dismiss: "閉じる",
    /**
     * 削除の確かめ（2026-09-29 に「一覧から消す」から「削除」へ。題に録音の名前、本文は何が消えるかと、何が残るかの2段落。
     * 1段落だと最後の行に「せん。」だけが残ったので分けた）
     */
    deleteTitle: (name: string) => `「${name}」を削除しますか？`,
    deleteBody: "この Mac に残っている文字起こし・名前・手直しを削除します。元に戻せません。",
    deleteKeeps: "元のファイルと、保存したファイルは削除しません。",
    deletedToast: "削除しました",
    /** ファイルをドラッグしている間、窓全体に出す案内（どの画面でも受ける） */
    dropTitle: "ここに落とすと、新しい録音として追加します",
    /** 中断した録音の説明・元のファイルが無いときの行の再生・削除の確かめのボタン（前の履歴の画面から移した。2026-09-27） */
    unfinishedDiar: "声の聞き分けまで済んでいます",
    unfinishedNone: "声の聞き分けの前に中断しました",
    playDisabled: "元のファイルが見つからないので再生できません",
    deleteConfirm: "削除",
  },

  /**
   * 新しい版の知らせ（約束 版10。2026-09-27 決定: 自動では入れ替えない。新しい録音の画面に帯、押すと更新内容と手順の窓。
   * 帯は版ごとに消せる（「この版は知らせない」）。窓の「あとで」は閉じるだけ）。手順は README の「入れ方」と同じ順
   */
  update: {
    band: (version: string) => `新しい版（${version}）があります`,
    bandSub: "手順を確かめてから、都合のよいときに入れ替えてください。自動では入れ替えません。",
    show: "内容と手順を見る",
    skip: "この版は知らせない",
    title: (title: string) => `${title} があります`,
    published: (day: string) => `${day}に公開`,
    current: (version: string) => `今の版は ${version}`,
    notesTitle: "更新内容",
    notesEmpty: "更新内容は、リリースのページを見てください。",
    stepsTitle: "入れ替えかた",
    steps: (version: string) => [
      `「リリースのページを開く」で開いたページから、「Kikiwake_${version}_aarch64.dmg」をダウンロードします`,
      "Kikiwake を終了します（⌘Q）",
      ".dmg を開き、「Kikiwake」を「アプリケーション」にドラッグして入れ替えます（確かめが出たら「置き換える」を押します）",
      "Kikiwake を開きます。開けないという警告が出たら「完了」を押します（「ゴミ箱に入れる」は押さないでください）",
      "アップルメニュー →「システム設定」→「プライバシーとセキュリティ」を開き、下のほうの「このまま開く」を押して、パスワードを入れます",
      "もう一度出る確かめで「このまま開く」を押すと、新しい版で開きます",
    ],
    macos14: "macOS 14 では 4〜6 の代わりに、Finder で Kikiwake を右クリック →「開く」→ もう一度「開く」を押します。",
    note: "警告は、Apple の有料の開発者登録をしていないために出るもので、壊れているわけではありません。これまでの文字起こし（録音の一覧）と AI モデルは、そのまま使えます。",
    later: "あとで",
    open: "リリースのページを開く",
    /** 「AI モデルと動作条件」の設定（2026-09-27 決定: 置く・初めは確かめる） */
    settingTitle: "新しい版の確認",
    settingLabel: "起動したときに新しい版を確かめる",
    settingNote:
      "GitHub に最新の版の番号を尋ねるだけで、録音や文字は送りません（GitHub には、この Mac の IP アドレスと Kikiwake の版の番号が伝わります）。外すと、起動しても尋ねず、新しい版の知らせも出ません。",
  },

  processing: {
    title: { running: "文字起こし中", done: "完了しました", cancelled: "中止しました", failed: "中断しました" } as Record<
      "running" | "done" | "cancelled" | "failed",
      string
    >,
    subTranscribe: "時間のほとんどはこの段階です",
    subReused: "前回の聞き分けの結果を使います",
    reused: "前回の結果を使用",
    done: "完了",
    waiting: "待ち",
    cancelled: "中止",
    failed: "失敗",
    inProgress: "進行中",
    almostDone: "まもなく終わります",
    calculating: "残り時間を計算中",
    elapsed: (clock: string) => `経過 ${clock}`,
    kept: "声の聞き分けの結果は残っています。再開すると、それを使って声を文字にするところからはじめます。",
    notKept: "声の聞き分けはまだ終わっていませんでした。再開すると最初からはじめます。",
    local: "文字起こしはこの PC の中だけで行っています。",
    /** 版13: マニュアル用に始めた録音 */
    screensNote: "マニュアル用に、画面の絵も取り出しています（文字起こしと同時に進めます）。",
    cancel: "中止",
    retry: "再開する",
  },

  naming: {
    lead: "声を聞いて、誰の声か名前を入れてください。同じ名前を付けた話者は、1人にまとめます。名前を空けた話者は「話者A」などのまま保存します。",
    warning: {
      short_talk: "発言がとても短い話者です。ほかの人の声の断片かもしれません。",
      mixed_voices: "2人の声が混ざっている可能性があります。",
    } as Record<SpeakerWarning, string>,
    /** サンプルの位置（1・2・3） */
    position: (index: number) => ({ 1: "序盤", 2: "中盤", 3: "終盤" } as Record<number, string>)[index] ?? "",
    insertTitle: "入力欄に入れる",
    merged: "（まとめ）",
    noName: "名前なし",
    hasWarning: "注意あり",
    talkTime: "発言時間",
    utterances: "発言",
    times: (n: number) => `${n}回`,
    firstSeen: "初登場",
    nameLabel: "名前",
    placeholder: (label: string) => `空けると「${label}」のまま`,
    insert: (name: string) => `${name} を入れる`,
    clue: "名前の手がかり：",
    clueNone: "見つかりませんでした",
    mergeNote: (name: string, labels: string) => `「${name}」として ${labels} を1人にまとめます`,
    noSamples: "聞けるサンプルがありません",
    hintsTitle: "確認用の部分で名乗った名前",
    hintsLead: "誰の声か決められなかった部分（確認用）で名乗っていた名前です。声を聞いて、どの話者の声か見比べてください。",
    insertInto: (name: string, label: string) => `${name} を${label} に入れる`,
    prev: "前の話者",
    next: "次の話者",
    /** 手がかりの出どころ: 「自己紹介2」。並べるときは sourceSep でつなぐ */
    source: (kind: string, n: number) => `${kind}${n}`,
    sourceSep: "・",
    /** 名前の手がかり: 「田中（自己紹介2・呼びかけ直後1）」 */
    hint: (name: string, sources: string) => `${name}（${sources}）`,
  },

  result: {
    details: "詳細",
    searchPlaceholder: "本文を検索",
    matches: (current: number, total: number) => `${current} / ${total}件`,
    noMatches: "0件",
    prev: "前へ",
    next: "次へ",
    hint: "* は声の重なり ・ 名前も文字もダブルクリックで直せます",
    editedRows: (n: number) => `直した行 ${n}`,
    revertAll: "すべて元の文字に戻す",
    showPeople: "表示する話者",
    showAll: "すべて表示",
    rows: (rows: string) => `${rows}行`,
    shownOf: (total: number, shown: number, rows: string) => `${total}人中${shown}人 ・ ${rows}行`,
    repeatTitle: "本文のこの箇所へ移る",
    repeatGo: "この箇所へ移る",
  },

  transcript: {
    nameTip: "ダブルクリックで名前を変える",
    nameTipOverridden: (label: string) => `この行だけ別の名前（元：${label}） ダブルクリックで変える`,
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
    confirmTip: "名前を入れた発言を本文に入れ、この欄から外します",
    confirm: "本文に入れる",
    jumpTip: "本文のこの箇所へ移って名前を入れる",
    arrow: (name: string) => `→ ${name}`,
    none: "残っていません。",
  },

  nameMenu: {
    aria: "この行の話者を選ぶ",
    heading: (time: string) => `この行の話者を選ぶ（${time}）`,
    labelName: "話者の名前",
    typedHere: "ここで入力",
    selected: "選択中",
    otherPlaceholder: "ほかの名前を入力",
    keys: (mod: string) => `${mod} + Enter で決定 ・ Esc で閉じる`,
    backToNoName: "確認用に戻す",
    backToLabel: (name: string) => `話者の名前に戻す（${name}）`,
  },

  /**
   * 保存（2026-09-29 決定: 下の帯は「保存…」だけ。形式と保存先は押して開く窓で選び、次からも同じにする。
   * 「保存しました」「Finder で表示」は帯から外した。Finder で表示は一覧の行の「…」から）
   */
  save: {
    /** 下の帯のボタン（押すと窓が開くので「…」を付ける） */
    open: "保存…",
    saving: "保存中…",
    title: "保存",
    formats: "形式",
    /** 形式ごとの一言（何が入るか） */
    formatHint: { md: "見出しつきの読みやすい文書", txt: "本文の行だけ", json: "ほかの道具で使うデータ" },
    folder: "保存先",
    /** 保存先の選択肢。既定は元のファイルと同じフォルダ（録音ごとに変わる） */
    sameAsSource: (folder: string) => `元のファイルと同じフォルダ（${folder}）`,
    /** 元のファイルのフォルダが無い（外付けを外した など）とき、エンジンは書類フォルダを返す */
    sourceFolderGone: (folder: string) => `${folder}（元のファイルのフォルダが見つからないため）`,
    /** Mac のフォルダを選ぶ画面が開く */
    pickOther: "ほかのフォルダを選ぶ…",
    /** Mac の Finder が見せる名前（ホームの中のフォルダ） */
    homeFolders: {
      Desktop: "デスクトップ",
      Documents: "書類",
      Downloads: "ダウンロード",
      Movies: "ムービー",
      Music: "ミュージック",
      Pictures: "ピクチャ",
      Public: "パブリック",
      Shared: "共有",
    } as Record<string, string>,
    cancel: "キャンセル",
    save: "保存",
    /** 版13: マニュアル用にした録音だけ出す。毎回外れた状態で開き、選んだときだけ zip を保存する（覚えない。2026-10-12 決定） */
    zipTitle: "マニュアルの素材",
    zipHint: (frames: number) => `場面ごとの画面の絵 ${frames} 枚・文字起こし・AI への説明`,
    zipFaces: (n: number) => `顔が写っているかもしれない絵が ${n} 枚あります。渡す前に確かめてください。`,
    zipNone: "画面の共有が見つからなかったので、作れません",
    zipError: "録画を読み取れなかったので、作れません",
    /** 版14: 前の版で読み取った録画（判定の版が上がった）。窓の下に作り直し方（エンジンの screens_outdated の文）を出す */
    zipOutdated: "前の版で読み取ったので、このままでは作れません",
    /** 保存できたときの知らせ（保存したファイルの名前） */
    savedToast: (file: string, more: number) => (more > 0 ? `「${file}」ほか${more}件を保存しました` : `「${file}」を保存しました`),
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
    speakersValue: (people: number, labels: number) => `${people}人（話者 ${labels} から）`,
    overlaps: "声の重なり（*）",
    overlapsValue: (n: string) => `${n}箇所`,
    editsTitle: "手直し",
    editedRows: "文字を直した行",
    renamedRows: "名前を個別に変えた行",
    rowsValue: (n: string) => `${n}行`,
    pending: "確認用の残り",
    pendingValue: (pending: string, confirmed: string) => `${pending}件（本文に入れた ${confirmed}件）`,
  },

  dialog: {
    cancelTitle: "文字起こしを中止しますか？",
    cancelKeep: "続ける",
    cancelConfirm: "中止する",
    cancelBodyKept: "声の聞き分けの結果は残ります。再開するときはそれを使い、声を文字にするところからはじめます。",
    cancelBodyNotKept: "声の聞き分けはまだ終わっていないため、再開すると最初からはじめます。",
    closeTitle: "文字起こし中です。閉じますか？",
    closeKeep: "文字起こしを続ける",
    closeConfirm: "閉じる",
    /**
     * 処理中に閉じるときの本文（2026-09-27 決定: 何が残り、何を破棄するかを正確に。「破棄します」で強めに）。
     * 処理中の録音の段階で3通り（声の聞き分けの前／声を文字にしている間／まとめている間）と、順番待ちがあるときの一文。
     * 90 分以下の録音は、声を文字にし終えて初めて文字起こしを残す。90 分を超える録音は約1時間ずつ区切って文字にし、書き終えた区切りは残る
     */
    closeBody: {
      beforeSeparation: (name: string) => `閉じると「${name}」の文字起こしを中断し、ここまでの途中の分は破棄します。再開すると最初からはじめます。`,
      converting: (name: string) =>
        `閉じると「${name}」の文字起こしを中断します。声の聞き分けの結果は残りますが、声を文字にしている途中の分は破棄し、再開すると声を文字にするところからやり直します（90 分を超える録音は、約1時間ごとの区切りで書き終えた分は残ります）。`,
      finishing: (name: string) => `閉じると「${name}」の文字起こしを中断します。声の聞き分けと文字にした結果は残り、再開するとすぐに終わります。`,
      queue: (n: number) => `順番待ちの ${n} 件は破棄します。まだはじめていないので、元のファイルも文字起こしも失いません。`,
    },
    stay: "やめる",
    revertTitle: "すべて元の文字に戻しますか？",
    revertConfirm: "元に戻す",
    revertBody: (n: number) => `直した ${n} 行を、文字起こししたときの文字に戻します。名前は変わりません。`,
    overwriteTitle: "同じ名前のファイルがあります",
    overwriteConfirm: "上書きする",
    overwriteBody: (files: string) => `保存先に同じ名前のファイルがあります（${files}）。上書きすると、前のファイルは元に戻せません。`,
  },

  toast: {
    reverted: "元の文字に戻しました",
    confirmed: (n: number) => `${n}件を本文に入れました`,
    copied: "エラーの詳細をコピーしました",
    relinked: "元のファイルを選び直しました",
  },

  /**
   * エンジン（Rust）が日本語で返すもの。画面の言葉（頭の用語）にそろえて出す。知らない文はそのまま。
   * エンジンの文そのもの（ログ・「詳細をコピー」の中身）は変えない
   */
  engine: {
    stage: (stage: Stage) => ({ extract: "音声を取り出す", diarize: "声を聞き分ける", transcribe: "声を文字にする", merge: "まとめる" })[stage],
    error: (e: AppError) => {
      if (e.code === "cancelled") {
        return e.message.includes("残して") ? "中止しました。声の聞き分けの結果は残してあるので、再開すると続きからはじめます。" : "中止しました。";
      }
      return ERRORS[e.code] ?? e.message;
    },
    envMessage: (item: EnvironmentItem) => ENVIRONMENT[item.message] ?? item.message,
    gpuName: (name: string) => name,
    modelLabel: (_id: ModelId, label: string) => label,
    /** 「話者A」などはそのまま。誰の声か決められなかった発言の「不明」は、画面では「確認用」（保存したファイルの見出しと同じ） */
    speakerLabel: (label: string) => (label === "不明" ? "確認用" : label),
    /** 手がかりの種類（「自己紹介」「呼びかけ直後」） */
    hintKind: (kind: string) => kind,
    repeat: (n: RepeatNotice) => `${hms(n.startSec)}〜${hms(n.endSec)} の文字起こしは、同じ文の繰り返しになっていて読めません`,
  },
};

export type Messages = typeof ja;
