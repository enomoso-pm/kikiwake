// 確認のダイアログ（UI 画面仕様書 §2.5）。暗い所を押しても閉じない。Esc は取り消し。開いたときは取り消しにフォーカス
import { useEffect, useId, useRef, type ReactNode } from "react";
import { isEscape } from "../lib/keys";

export interface DialogProps {
  title: string;
  children: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** 決める側のボタンの色（初めは消す・止める向けの赤。版15 の「文字起こしし直す」は青） */
  confirmTone?: "danger" | "primary";
}

export function Dialog({ title, children, cancelLabel, confirmLabel, onCancel, onConfirm, confirmTone = "danger" }: DialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEscape(e)) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Tab") {
        // フォーカスはダイアログの2つのボタンの間だけで回す
        e.preventDefault();
        const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
        next?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="scrim">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <span id={titleId} className="dialog-title">
          {title}
        </span>
        <div className="dialog-body">{children}</div>
        <div className="dialog-buttons">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className={`btn btn-${confirmTone}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
