// 画面2 ファイル選択（UI 画面仕様書 §5）
import type { AppError, FileDragOver } from "@contract/types";
import { api } from "../api";
import { toAppError } from "../lib/errors";
import { getState, setState } from "./state";

const UNSUPPORTED_FALLBACK: AppError = {
  code: "unsupported_format",
  message: "この形式には対応していません。対応している形式: mp4・mov・m4a・mp3・wav",
};

let inspectSeq = 0;

export async function inspectPath(path: string): Promise<void> {
  const my = ++inspectSeq;
  setState({ fileBusy: true, startError: null, dragOver: false });
  try {
    const info = await api.inspectFile(path);
    if (my !== inspectSeq) return;
    if (!info.supported) setState({ file: null, fileError: info.unsupported ?? UNSUPPORTED_FALLBACK, fileBusy: false });
    else setState({ file: info, fileError: null, fileBusy: false });
  } catch (e) {
    if (my !== inspectSeq) return;
    setState({ file: null, fileError: toAppError(e), fileBusy: false });
  }
}

export async function pickFile(): Promise<void> {
  try {
    const path = await api.pickMediaFile();
    if (path) await inspectPath(path);
  } catch (e) {
    setState({ fileError: toAppError(e) });
  }
}

/** 窓のどこに落としても受ける。ただしファイル選択の画面のときだけ。複数なら最初の1つ */
export function onFileDrop(paths: string[]): void {
  setState({ dragOver: false });
  if (getState().screen !== "file" || !paths.length) return;
  void inspectPath(paths[0]);
}

/**
 * 版6: アプリの中でのドラッグ（外枠が位置を知らせる。HTML5 の dragenter・dragover は届かない）。
 * ファイルの画面で、位置がドロップ枠の中にある間だけ枠の色を変える（UI 画面仕様書 §5.2）
 */
export function onFileDragOver(e: FileDragOver): void {
  if (getState().screen !== "file" || !e.over) {
    setDragOver(false);
    return;
  }
  const zone = document.querySelector("[data-drop-zone]")?.getBoundingClientRect();
  setDragOver(Boolean(zone && e.x >= zone.left && e.x <= zone.right && e.y >= zone.top && e.y <= zone.bottom));
}

export function setDragOver(over: boolean): void {
  if (getState().dragOver !== over) setState({ dragOver: over });
}

export function clearFile(): void {
  inspectSeq++;
  setState({ file: null, fileError: null, startError: null, fileBusy: false });
}
