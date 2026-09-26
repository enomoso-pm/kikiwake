// 結果の画面から別の録音へ移る（2026-09-26 決定。仕様書に無い）。
// 保存していない手直しがあれば確かめてから移る。移ると今の文字起こしの状態は消える。
// 結果の画面の右上の「完了」で完了の画面へ（工程の外。保存したかどうかに関係なく押せる）。
// そこから別の録音へ移るか、Kikiwake を終了する（同日の決定）
import { api } from "../api";
import { stopPlayback } from "../lib/player";
import { hasUnsavedEdits } from "./result";
import { getState, resultInitial, setState } from "./state";
import { goTo } from "./ui";

export function requestNewRecording(): void {
  if (hasUnsavedEdits(getState())) setState({ dialog: "leaveUnsaved" });
  else startNewRecording();
}

/** 結果の画面の右上の「完了」: 完了の画面へ（保存していなくてもよい） */
export function finish(): void {
  goTo("done");
}

/** 完了の画面の「Kikiwake を終了」。保存していない手直しがあれば、閉じる確認と同じダイアログで確かめる */
export async function requestQuit(): Promise<void> {
  if (hasUnsavedEdits(getState())) {
    setState({ dialog: "closeUnsaved" });
    return;
  }
  try {
    await api.closeApp();
  } catch {
    // 閉じられなかったときは、そのまま
  }
}

export function startNewRecording(): void {
  stopPlayback();
  setState({
    dialog: null,
    job: null,
    file: null,
    fileError: null,
    startError: null,
    speakers: [],
    hints: [],
    names: {},
    selectedLabel: null,
    applying: false,
    applyError: null,
    reachedResult: false,
    ...resultInitial(),
  });
  goTo("file");
}
