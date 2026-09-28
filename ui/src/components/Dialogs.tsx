// 確認のダイアログの出し分け（UI 画面仕様書 §2.5）。出している間も処理は止めない
// 「同じ名前のファイル」は仕様書に無い（約束 版3 のために足した。形は §2.5 と同じ）。削除の確かめは objects/ObjectsApp。
// 「保存していない手直し」の確かめは 2026-09-27 にやめた（手直しは作業フォルダに残る。約束 版8）
import { useT } from "../i18n";
import { closeCase } from "../lib/close";
import { basename } from "../lib/format";
import { closeInfo, confirmCancel, confirmClose, diarizationDone } from "../store/job";
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

  if (dialog === "cancel" && job) {
    return (
      <Dialog title={d.cancelTitle} cancelLabel={d.cancelKeep} confirmLabel={d.cancelConfirm} onCancel={close} onConfirm={() => void confirmCancel()}>
        {diarizationDone(job) ? d.cancelBodyKept : d.cancelBodyNotKept}
      </Dialog>
    );
  }
  if (dialog === "close") {
    // 何が残り、何を破棄するか（処理中の録音の段階と、順番待ちの数で。2026-09-27 決定）
    const info = closeInfo();
    return (
      <Dialog title={d.closeTitle} cancelLabel={d.closeKeep} confirmLabel={d.closeConfirm} onCancel={close} onConfirm={() => void confirmClose()}>
        {info ? (
          <>
            <p>{d.closeBody[closeCase(info.stage, info.reused)](info.name)}</p>
            {info.queued > 0 ? <p style={{ marginTop: 10 }}>{d.closeBody.queue(info.queued)}</p> : null}
          </>
        ) : null}
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
