// 結果の画面から別の録音へ移る（2026-09-26 決定。仕様書に無い）。
// 版8（2026-09-27 決定）: 手直しは作業フォルダに残り、履歴から開き直すと戻るので、保存していなくても確かめずに移る。
// 結果の画面の右上の「完了」で完了の画面へ（工程の外。保存したかどうかに関係なく押せる）。
// そこから別の録音へ移るか、Kikiwake を終了する（同日の決定）
import { api } from "../api";
import { stopPlayback } from "../lib/player";
import { resultInitial, setState } from "./state";
import { goTo } from "./ui";

export function requestNewRecording(): void {
  startNewRecording();
}

/** 結果の画面の右上の「完了」: 完了の画面へ（保存していなくてもよい） */
export function finish(): void {
  goTo("done");
}

/** 完了の画面の「Kikiwake を終了」（手直しは作業フォルダに残るので確かめない） */
export async function requestQuit(): Promise<void> {
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
    playable: true,
    relinkError: null,
    ...resultInitial(),
  });
  goTo("file");
}
