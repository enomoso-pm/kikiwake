// 録音が主役の画面（案A。2026-09-27 に製品の画面にした）: 左に録音の一覧、右に選んだ録音。
// 要望「OOUI の考え方で、どこからでも録音へ行き来できるように」から作った
import { useEffect, useState } from "react";
import { Dialog } from "../components/Dialog";
import { Dialogs } from "../components/Dialogs";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { Toast } from "../components/Toast";
import { UpdateDialog } from "../components/UpdateDialog";
import { mockDev } from "../api";
import { useT } from "../i18n";
import { SetupScreen } from "../screens/SetupScreen";
import { useApp } from "../store/state";
import { MainPane } from "./MainPane";
import { Sidebar } from "./Sidebar";
import { cancelDelete, confirmDelete, setOverlay, startObjects, useObjects } from "./store";
import { Toolbar } from "./Toolbar";
import "./objects.css";

/** 一覧を横に並べて置ける幅（これより狭いと、一覧は重ねて出す） */
const WIDE = "(min-width: 1100px)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const m = window.matchMedia(WIDE);
    const on = () => setWide(m.matches);
    // 幅の知らせ（change）が来ない場合もあるので、窓の大きさが変わったときにも見直す
    m.addEventListener("change", on);
    window.addEventListener("resize", on);
    return () => {
      m.removeEventListener("change", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return wide;
}

/** 「一覧から消す…」の確かめ（形はほかの確かめる窓と同じ） */
function DeleteDialog() {
  const t = useT();
  const item = useObjects((s) => s.deleting);
  if (!item) return null;
  return (
    <Dialog
      title={t.objects.deleteTitle}
      cancelLabel={t.dialog.stay}
      confirmLabel={t.objects.deleteConfirm}
      onCancel={cancelDelete}
      onConfirm={() => void confirmDelete()}
    >
      {t.objects.deleteBody(item.name)}
    </Dialog>
  );
}

/** ファイルをドラッグしている間、窓全体に出す案内（どの画面でも落とせば新しい録音になる。2026-09-27） */
function DropHint() {
  const t = useT();
  const dragging = useObjects((s) => s.dragging);
  const screen = useApp((s) => s.screen);
  // 「新しい録音」の画面は、今までどおりドロップ枠の色で知らせる
  if (!dragging || screen === "file" || screen === "setup") return null;
  return (
    <div className="objects-drop" aria-hidden="true">
      <div className="objects-drop-inner">
        <span className="objects-drop-title">{t.objects.dropTitle}</span>
        <span className="objects-drop-sub">{t.file.formats}</span>
      </div>
    </div>
  );
}

export default function ObjectsApp() {
  const t = useT();
  const wide = useWide();
  const collapsed = useObjects((s) => s.collapsed);
  const overlay = useObjects((s) => s.overlay);
  const reviewing = useObjects((s) => s.reviewing);
  const booted = useApp((s) => s.booted);
  const screen = useApp((s) => s.screen);

  useEffect(() => startObjects(), []);
  useEffect(() => {
    if (wide && overlay) setOverlay(false);
  }, [wide, overlay]);

  // AI モデルがそろうまで（はじめの準備）は、一覧・上の帯・タブを出さない（2026-09-27 決定）。起動の読み込み中も同じ
  if (!booted || (screen === "setup" && !reviewing)) {
    return (
      <div className="app" data-objects-layout="">
        <div className="objects-bare-bar">
          <span className="objects-brand">{t.objects.brand}</span>
        </div>
        <main className="app-body">{booted ? <SetupScreen /> : null}</main>
        <LanguageSwitch />
        <Dialogs />
        <Toast />
      </div>
    );
  }

  return (
    <div className="app objects-app" data-objects-layout="">
      {wide && !collapsed ? <Sidebar overlay={false} /> : null}
      <div className="objects-main">
        <Toolbar wide={wide} dev={Boolean(mockDev)} />
        <main className="app-body">
          <MainPane />
        </main>
      </div>
      {!wide && overlay ? (
        <>
          <div className="objects-scrim" onClick={() => setOverlay(false)} />
          <Sidebar overlay />
        </>
      ) : null}
      <LanguageSwitch />
      <DropHint />
      <Dialogs />
      <DeleteDialog />
      <UpdateDialog />
      <Toast />
    </div>
  );
}
