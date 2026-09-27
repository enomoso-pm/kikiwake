// 確認のダイアログの出し分け（UI 画面仕様書 §2.5）。出している間も処理は止めない
// 「同じ名前のファイル」「履歴から消す」は仕様書に無い（約束 版3・版8 のために足した。形は §2.5 と同じ）。
// 「保存していない手直し」の確かめは 2026-09-27 にやめた（手直しは作業フォルダに残る。約束 版8）
import { useT } from "../i18n";
import { basename } from "../lib/format";
import { confirmCancel, confirmClose, diarizationDone } from "../store/job";
import { cancelDeleteHistory, confirmDeleteHistory } from "../store/history";
import { cancelOverwrite, revertAllTexts, save } from "../store/result";
import { setState, useApp } from "../store/state";
import { Dialog } from "./Dialog";

const close = () => setState({ dialog: null });

export function Dialogs() {
  const t = useT();
  const d = t.dialog;
  const dialog = useApp((s) => s.dialog);
  const job = useApp((s) => s.job);
  const editedRows = useApp((s) => Object.keys(s.textHistory).length);
  const existing = useApp((s) => s.overwrite);
  const historyDelete = useApp((s) => s.historyDelete);

  if (dialog === "cancel" && job) {
    return (
      <Dialog title={d.cancelTitle} cancelLabel={d.cancelKeep} confirmLabel={d.cancelConfirm} onCancel={close} onConfirm={() => void confirmCancel()}>
        {diarizationDone(job) ? d.cancelBodyKept : d.cancelBodyNotKept}
      </Dialog>
    );
  }
  if (dialog === "close") {
    return (
      <Dialog title={d.closeTitle} cancelLabel={d.closeKeep} confirmLabel={d.closeConfirm} onCancel={close} onConfirm={() => void confirmClose()}>
        {d.closeBody}
      </Dialog>
    );
  }
  if (dialog === "deleteHistory" && historyDelete) {
    return (
      <Dialog
        title={t.history.deleteTitle}
        cancelLabel={d.stay}
        confirmLabel={t.history.deleteConfirm}
        onCancel={cancelDeleteHistory}
        onConfirm={() => void confirmDeleteHistory()}
      >
        {t.history.deleteBody(historyDelete.name)}
      </Dialog>
    );
  }
  if (dialog === "revertAll") {
    return (
      <Dialog title={d.revertTitle} cancelLabel={d.stay} confirmLabel={d.revertConfirm} onCancel={close} onConfirm={revertAllTexts}>
        {d.revertBody(editedRows)}
      </Dialog>
    );
  }
  if (dialog === "overwrite" && existing) {
    return (
      <Dialog title={d.overwriteTitle} cancelLabel={d.stay} confirmLabel={d.overwriteConfirm} onCancel={cancelOverwrite} onConfirm={() => void save(true)}>
        {d.overwriteBody(existing.map(basename).join(t.common.listSep))}
      </Dialog>
    );
  }
  return null;
}
