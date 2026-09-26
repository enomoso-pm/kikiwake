// 確認のダイアログの出し分け（UI 画面仕様書 §2.5）。出している間も処理は止めない
// 「同じ名前のファイル」「保存していない手直し」は仕様書に無い（約束 版3・2026-09-26 の決定のために足した。形は §2.5 と同じ）
import { basename } from "../lib/format";
import { confirmCancel, confirmClose, diarizationDone } from "../store/job";
import { startNewRecording } from "../store/leave";
import { cancelOverwrite, revertAllTexts, save } from "../store/result";
import { setState, useApp } from "../store/state";
import { Dialog } from "./Dialog";

const close = () => setState({ dialog: null });

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const job = useApp((s) => s.job);
  const editedRows = useApp((s) => Object.keys(s.textHistory).length);
  const existing = useApp((s) => s.overwrite);

  if (dialog === "cancel" && job) {
    return (
      <Dialog title="処理を中止しますか？" cancelLabel="続ける" confirmLabel="中止する" onCancel={close} onConfirm={() => void confirmCancel()}>
        {diarizationDone(job)
          ? "話者の判定の結果は残ります。やり直すときはそれを使い、書き起こしから始めます。"
          : "話者の判定はまだ終わっていないため、やり直すと最初から始めます。"}
      </Dialog>
    );
  }
  if (dialog === "close") {
    return (
      <Dialog title="処理中です。閉じますか？" cancelLabel="処理を続ける" confirmLabel="閉じる" onCancel={close} onConfirm={() => void confirmClose()}>
        閉じると処理が止まります。話者の判定が済んでいれば、その結果は残ります。
      </Dialog>
    );
  }
  if (dialog === "closeUnsaved") {
    return (
      <Dialog title="保存していない手直しがあります。閉じますか？" cancelLabel="やめる" confirmLabel="閉じる" onCancel={close} onConfirm={() => void confirmClose()}>
        閉じると、この文字起こしで直した内容（行の名前・確認用の確定・文字）は消えます。先に保存するときは「やめる」を押してください。
      </Dialog>
    );
  }
  if (dialog === "leaveUnsaved") {
    return (
      <Dialog title="保存していない手直しがあります" cancelLabel="やめる" confirmLabel="別の録音へ移る" onCancel={close} onConfirm={startNewRecording}>
        別の録音へ移ると、この文字起こしで直した内容（行の名前・確認用の確定・文字）は消えます。先に保存するときは「やめる」を押してください。
      </Dialog>
    );
  }
  if (dialog === "revertAll") {
    return (
      <Dialog title="すべて元の文字に戻しますか？" cancelLabel="やめる" confirmLabel="元に戻す" onCancel={close} onConfirm={revertAllTexts}>
        直した {editedRows} 行を、書き起こしたときの文字に戻します。名前は変わりません。
      </Dialog>
    );
  }
  if (dialog === "overwrite" && existing) {
    return (
      <Dialog title="同じ名前のファイルがあります" cancelLabel="やめる" confirmLabel="上書きする" onCancel={cancelOverwrite} onConfirm={() => void save(true)}>
        保存先に同じ名前のファイルがあります（{existing.map(basename).join("・")}）。上書きすると、前のファイルは元に戻せません。
      </Dialog>
    );
  }
  return null;
}
