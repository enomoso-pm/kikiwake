// 「＋ 新しい録音」へ移る（2026-09-26・2026-09-27 決定。手直しは作業フォルダに残り、一覧から開き直すと戻るので、保存していなくても確かめない）
import { stopPlayback } from "../lib/player";
import { resultInitial, setState } from "./state";
import { goTo } from "./ui";

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
    playable: true,
    relinkError: null,
    ...resultInitial(),
  });
  goTo("file");
}
