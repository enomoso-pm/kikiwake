// 画面の移り変わり・トースト・「詳細をコピー」（UI 画面仕様書 §2.3・§2.6）
import type { AppError } from "@contract/types";
import { copyText } from "../lib/clipboard";
import { errorDetailText } from "../lib/errors";
import { stopPlayback } from "../lib/player";
import { setState, type Screen } from "./state";

let toastTimer = 0;
let toastSeq = 0;

/** 2.2 秒で消える。新しいものが来たら入れ替え、時間は数え直す */
export function showToast(text: string): void {
  clearTimeout(toastTimer);
  setState({ toast: { id: ++toastSeq, text } });
  toastTimer = window.setTimeout(() => setState({ toast: null }), 2200);
}

export async function copyErrorDetail(error: AppError): Promise<void> {
  await copyText(errorDetailText(error));
  showToast("エラーの詳細をコピーしました");
}

/** 画面を移る。鳴っている音・文字の編集・名前を選ぶ欄・詳細は閉じる */
export function goTo(screen: Screen): void {
  stopPlayback();
  setState({ screen, editing: null, nameMenu: null, detailOpen: false });
}
