// キー操作（UI 画面仕様書 §2.7）。日本語入力の変換中の Enter は、どれも決定として扱わない

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
}

export function isComposing(e: KeyLike): boolean {
  return Boolean(e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229);
}

/** 決定: ⌘+Enter（Windows は Ctrl+Enter） */
export function isCommitKey(e: KeyLike): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isComposing(e);
}

/** Enter 単独（検索欄の「次の一致」など） */
export function isPlainEnter(e: KeyLike): boolean {
  return e.key === "Enter" && !e.metaKey && !e.ctrlKey && !isComposing(e);
}

export function isEscape(e: KeyLike): boolean {
  return e.key === "Escape" && !isComposing(e);
}
