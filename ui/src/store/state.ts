// 画面の状態（UI 側だけのもの。UI 画面仕様書 §9）。約束の型はそのまま使い、書き直さない。
// 状態はここに置き、変える処理は store/ の各ファイルの関数にまとめる。
import { create } from "zustand";
import type {
  AppError,
  EnvironmentCheck,
  FileInfo,
  HistoryItem,
  ModelInfo,
  Names,
  SaveFormat,
  ScreensInfo,
  SpeakerCard,
  Stage,
  TranscriptView,
  UnresolvedHint,
  UpdateInfo,
} from "@contract/types";

/**
 * 右に出す中身（録音が主役の画面。2026-09-27）。file は「＋ 新しい録音」、naming と result は録音の「話者」「文字起こし」のタブ。
 * 前の形の履歴の画面・完了の画面は、左の録音の一覧と状態の印に置き換えて無くした
 */
export type Screen = "setup" | "file" | "processing" | "naming" | "result";

export const SCREENS: readonly Screen[] = ["setup", "file", "processing", "naming", "result"];

/**
 * 保存していない手直しの確かめ（閉じる・別の録音へ移る）は 2026-09-27 にやめた（手直しは作業フォルダに残る。約束 版8）。
 * save は「保存…」で開く窓（形式と保存先を選ぶ。2026-09-29）
 */
export type DialogKind = "cancel" | "close" | "revertAll" | "overwrite" | "save";

export interface JobView {
  /** startJob が返るまでは null */
  jobId: string | null;
  path: string;
  /** 保存先の既定（エンジンが返す） */
  outDir: string;
  status: "running" | "cancelled" | "failed" | "done";
  stage: Stage;
  /** 書き起こしの％（戻らない） */
  percent: number;
  etaSec: number | null;
  reused: boolean;
  startedAt: number;
  endedAt: number | null;
  error: AppError | null;
  diarizationKept: boolean;
  cancelRequested: boolean;
  /** 版13: マニュアル用に、画面の絵も取り出している（始めたときに選んだ。処理中の画面に一文を出す） */
  screens?: boolean;
}

export interface NameMenuState {
  id: string;
  anchor: { left: number; top: number; bottom: number };
  value: string;
}

export interface AppState {
  booted: boolean;
  bootError: AppError | null;
  screen: Screen;
  dialog: DialogKind | null;
  toast: { id: number; text: string } | null;

  // 新しい版の知らせ（約束 版10）
  /** 起動したときに尋ねた答え（無い・確かめられないときは null） */
  update: UpdateInfo | null;
  /** 「この版は知らせない」にした版（覚えておく。store/update.ts） */
  updateDismissed: string | null;
  /** 起動したときに新しい版を確かめる（「AI モデルと動作条件」で止められる。初めは確かめる。2026-09-27 決定） */
  updateCheck: boolean;
  /** 更新内容と手順の窓を出している */
  updateOpen: boolean;

  // 1 準備
  env: EnvironmentCheck | null;
  models: ModelInfo[];
  setupError: AppError | null;

  // 2 ファイル
  file: FileInfo | null;
  fileError: AppError | null;
  fileBusy: boolean;
  dragOver: boolean;
  startError: AppError | null;
  /** 版13: 選んだ録画で「マニュアル用に、画面の絵も取り出す」にチェックを入れている（ファイルを選び直すと外れる） */
  screensOn: boolean;

  // 履歴（版8）
  /** 一覧。読む前は null */
  history: HistoryItem[] | null;
  historyError: AppError | null;
  /** 開いている（音声を取り出している）録音の jobId */
  historyOpening: string | null;
  /** 結果の画面で行を再生できるか（履歴から元ファイルの無い録音を開いたら false） */
  playable: boolean;
  relinkError: AppError | null;

  // 3 処理中
  job: JobView | null;

  // 4 名前付け
  speakers: SpeakerCard[];
  hints: UnresolvedHint[];
  /** ラベル → 入力された名前（そのまま。比べるときに前後の空白と全角・半角をそろえる） */
  names: Record<string, string>;
  selectedLabel: string | null;
  applying: boolean;
  applyError: AppError | null;

  // 5 結果
  view: TranscriptView | null;
  /** applyNames に渡した名前（ラベル → まとまった名前） */
  appliedNames: Names;
  /** 行の id → その行だけの名前（確認用の行の名前もここ） */
  lineNames: Record<string, string>;
  /** 確定した確認用の行の id */
  confirmed: Record<string, true>;
  /** 行の id → 直した文字の履歴。最後が今の文字 */
  textHistory: Record<string, string[]>;
  /** 表示しない人（名前で持つ。「名無し」は NO_NAME） */
  hidden: Record<string, true>;
  search: string;
  matchIndex: number;
  editing: { id: string; value: string } | null;
  nameMenu: NameMenuState | null;
  flashId: string | null;
  /** 本文の一覧に「この行へ移って」と頼む（一覧が受けて流す） */
  scrollRequest: { id: string; seq: number; openMenu: boolean } | null;
  /** 最後に保存したときの形式と保存先（2026-09-29 から、選ぶのは「保存…」の窓。次に開いたときの初めの値は store/savePrefs が覚えている） */
  formats: Record<SaveFormat, boolean>;
  outDir: string;
  saving: boolean;
  saved: { files: string[] } | null;
  /**
   * 最後に保存したファイル（約束 版12 の JobDraft.lastSavedFiles）。saved と違い、保存したあとで名前を変えても消さない
   * （一覧の行の「…」の「Finder で表示」で、前に保存したファイルを見せるため）
   */
  lastSaved: string[];
  /**
   * この録音の文字起こしをファイルに保存したことがある（約束 版9 の JobDraft.savedOnce）。保存したあとで名前を変えると
   * saved（「保存しました」）は消えるが、これは残る（一覧の状態の印「保存後に手直し」のため）
   */
  savedOnce: boolean;
  saveError: AppError | null;
  /** 上書きの確認で見せる、同じ名前のファイル */
  overwrite: string[] | null;
  /** 最後に保存したときの手直し（名前と手直しを文字にしたもの）。保存していない手直しがあるかを比べる */
  savedEdits: string | null;
  detailOpen: boolean;
  /** 版13: マニュアル用にした録音の画面の絵の数（JobDone.screens）。マニュアル用にしていなければ null */
  screens: ScreensInfo | null;
  /** 版13: 「保存…」の窓で「マニュアルの素材（.zip）」を選んだ（この保存だけ。覚えない） */
  saveZip: boolean;
}

/** 「名無し」を表示する人の鍵にするときの値 */
export const NO_NAME = "\u0000名無し";

export const resultInitial = (): Pick<
  AppState,
  | "view"
  | "appliedNames"
  | "lineNames"
  | "confirmed"
  | "textHistory"
  | "hidden"
  | "search"
  | "matchIndex"
  | "editing"
  | "nameMenu"
  | "flashId"
  | "scrollRequest"
  | "formats"
  | "outDir"
  | "saving"
  | "saved"
  | "lastSaved"
  | "savedOnce"
  | "saveError"
  | "overwrite"
  | "savedEdits"
  | "detailOpen"
  | "screens"
  | "saveZip"
> => ({
  view: null,
  appliedNames: {},
  lineNames: {},
  confirmed: {},
  textHistory: {},
  hidden: {},
  search: "",
  matchIndex: 0,
  editing: null,
  nameMenu: null,
  flashId: null,
  scrollRequest: null,
  formats: { md: true, txt: false, json: false },
  outDir: "",
  saving: false,
  saved: null,
  lastSaved: [],
  savedOnce: false,
  saveError: null,
  overwrite: null,
  savedEdits: null,
  detailOpen: false,
  screens: null,
  saveZip: false,
});

export const useApp = create<AppState>()(() => ({
  booted: false,
  bootError: null,
  screen: "setup",
  dialog: null,
  toast: null,

  update: null,
  updateDismissed: null,
  updateCheck: true,
  updateOpen: false,

  env: null,
  models: [],
  setupError: null,

  file: null,
  fileError: null,
  fileBusy: false,
  dragOver: false,
  startError: null,
  screensOn: false,

  history: null,
  historyError: null,
  historyOpening: null,
  playable: true,
  relinkError: null,

  job: null,

  speakers: [],
  hints: [],
  names: {},
  selectedLabel: null,
  applying: false,
  applyError: null,

  ...resultInitial(),
}));

export const getState = useApp.getState;
export const setState = useApp.setState;

const guessMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Mac か（⌘／Ctrl、Finder／エクスプローラーの出し分け）。動作条件が届くまでは推測 */
export function isMacState(s: AppState): boolean {
  return s.env ? s.env.os === "macos" : guessMac;
}

export function useIsMac(): boolean {
  return useApp(isMacState);
}

/** 条件がそろうまで待つ（開発用の画面の移動で使う） */
export function waitFor(pred: (s: AppState) => boolean, timeoutMs = 8000): Promise<boolean> {
  if (pred(getState())) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, timeoutMs);
    const unsub = useApp.subscribe((s) => {
      if (pred(s)) {
        clearTimeout(timer);
        unsub();
        resolve(true);
      }
    });
  });
}
