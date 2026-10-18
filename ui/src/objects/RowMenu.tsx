// 一覧の行の「…」（2026-09-29 決定。「履歴に3点リーダーを出して、そこで Finder で表示と削除」という要望から）。
// 中は「Finder で表示」（その録音で最後に保存したファイル。一度も保存していなければ押せない）と「削除…」（今までと同じ確かめ）。
// 一覧はスクロールし、狭い窓では重ねて出すので、メニューは body に置いて、ボタンの下（下が足りなければ上）に出す
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { isEscape } from "../lib/keys";
import { useApp, useIsMac } from "../store/state";
import { MoreIcon } from "./icons";
import type { Entry } from "./model";
import { askRelang, deleteEntry, revealSavedOf } from "./store";

type HistoryEntry = Extract<Entry, { kind: "history" }>;

const MENU_WIDTH = 240;

export function RowMenu({ entry, name, onOpenChange }: { entry: HistoryEntry; name: string; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const o = t.objects;
  const isMac = useIsMac();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [byKey, setByKey] = useState(false);
  // 開いている録音は画面の値（保存したばかりでも押せる）、ほかはエンジンの一覧の値（約束 版12）
  const liveSaved = useApp((s) => (s.job?.jobId === entry.item.jobId && s.job.status === "done" ? s.lastSaved.length : 0));
  const canReveal = liveSaved > 0 || (entry.item.savedFiles?.length ?? 0) > 0;
  // 版15: 書き終えた録音を、もう一方の言語で文字起こしし直す（元のファイルが要る。言語の記録が無い前の版の録音は日本語）
  const done = entry.item.status === "done";
  const other = (entry.item.language ?? "ja") === "ja" ? "en" : "ja";
  const canRelang = done && entry.item.sourceState === "ok";
  const open = pos !== null;

  const close = (focusButton = false) => {
    setPos(null);
    onOpenChange(false);
    if (focusButton) btnRef.current?.focus();
  };

  const toggle = (keyboard: boolean) => {
    if (open) {
      close();
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setByKey(keyboard);
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_WIDTH) });
    onOpenChange(true);
  };

  // 下が足りなければ、ボタンの上に出す（高さは出してから測る）。キーボードで開いたら最初の押せる項目へ
  useLayoutEffect(() => {
    const m = menuRef.current;
    const r = btnRef.current?.getBoundingClientRect();
    if (!open || !m || !r) return;
    const h = m.getBoundingClientRect().height;
    if (r.bottom + 4 + h > window.innerHeight - 8 && r.top - 4 - h > 8) setPos((p) => (p ? { ...p, top: r.top - 4 - h } : p));
    if (byKey) m.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, byKey]);

  // 外を押す・Esc・一覧のスクロール・窓の大きさが変わったら閉じる。↑↓で項目を移る
  useEffect(() => {
    if (!open) return;
    const shut = (focusButton = false) => {
      setPos(null);
      onOpenChange(false);
      if (focusButton) btnRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !btnRef.current?.contains(target)) shut();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEscape(e)) {
        e.preventDefault();
        e.stopPropagation();
        shut(true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1].focus();
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) shut();
    };
    const onResize = () => shut();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onOpenChange]);

  const run = (action: () => void) => {
    close();
    action();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="objects-row-more"
        title={o.rowMenu}
        aria-label={o.rowMenuAria(name)}
        aria-haspopup="menu"
        aria-expanded={open}
        // detail が 0 ならキーボード（Enter・スペース）で押した
        onClick={(e) => toggle(e.detail === 0)}
      >
        <MoreIcon />
      </button>
      {pos
        ? createPortal(
            <div
              ref={menuRef}
              className="objects-menu objects-row-menu"
              role="menu"
              aria-label={o.rowMenuAria(name)}
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            >
              <button type="button" role="menuitem" disabled={!canReveal} onClick={() => run(() => void revealSavedOf(entry))}>
                {t.common.reveal(isMac)}
                {!canReveal ? <span className="objects-menu-note">{o.notSavedYet}</span> : null}
              </button>
              {done ? (
                <button type="button" role="menuitem" disabled={!canRelang} onClick={() => run(() => askRelang(entry.item, other))}>
                  {o.relang(other)}
                  {!canRelang ? <span className="objects-menu-note">{o.relangNeedsSource}</span> : null}
                </button>
              ) : null}
              <button type="button" role="menuitem" className="danger" onClick={() => run(() => deleteEntry(entry.item))}>
                {o.remove}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
