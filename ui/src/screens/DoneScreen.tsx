// 完了の画面（2026-09-26 決定。仕様書に無い）。準備と同じく工程の外。
// 結果の画面の右上の「完了」から来る（保存したかどうかに関係なく押せる）。別の録音へ移るか、Kikiwake を終了する。
// 部品はファイルの画面のカード（左に名前、右にボタン）・帯と、結果の画面の「← 名前付けに戻る」と同じ形
import { useT } from "../i18n";
import { basename } from "../lib/format";
import { requestNewRecording, requestQuit } from "../store/leave";
import { hasUnsavedEdits, revealSaved } from "../store/result";
import { useApp, useIsMac } from "../store/state";
import { goTo } from "../store/ui";

/** 保存したファイルのあるフォルダ（Mac の / と Windows の \ の両方） */
function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

export function DoneScreen() {
  const t = useT();
  const saved = useApp((s) => s.saved);
  const unsaved = useApp(hasUnsavedEdits);
  const name = useApp((s) => s.file?.name ?? (s.view ? basename(s.view.source) : ""));
  const named = useApp((s) => Object.values(s.appliedNames).some((v) => v.trim()));
  const isMac = useIsMac();
  const files = saved?.files ?? [];
  const savedAll = files.length > 0 && !unsaved;

  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            className="btn-link nowrap"
            onClick={() => goTo("result")}
            style={{ alignSelf: "flex-start", font: "inherit", fontSize: 13, padding: "2px 0", cursor: "pointer" }}
          >
            {t.common.backToTranscript}
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>{savedAll ? t.done.titleSaved : t.done.titleDone}</h1>
          <p className="pretty" style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.75 }}>
            {t.done.lead}
          </p>
        </div>

        <div
          className="card"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 20px" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600, overflowWrap: "anywhere" }}>{name}</span>
            <span style={{ fontSize: 13, color: "var(--ink-3)", overflowWrap: "anywhere" }}>
              {files.length ? files.map(basename).join(t.common.listSep) : t.done.notSavedFiles}
            </span>
            {files.length ? (
              <span className="mono ellipsis" title={folderOf(files[0])} style={{ fontSize: 12, color: "var(--ink-4)" }}>
                {folderOf(files[0])}
              </span>
            ) : null}
          </div>
          {files.length ? (
            <button type="button" className="btn btn-mid" onClick={() => void revealSaved()}>
              {t.common.reveal(isMac)}
            </button>
          ) : null}
        </div>

        {unsaved ? (
          <div className="band-warn" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t.done.unsavedTitle}</span>
            <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
              {t.done.unsavedBody}
            </span>
          </div>
        ) : !files.length ? (
          <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t.done.notSavedTitle}</span>
            <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
              {t.done.notSavedBody(named)}
            </span>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={requestNewRecording}>
            {t.done.another}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void requestQuit()}>
            {t.done.quit}
          </button>
        </div>
      </div>
    </div>
  );
}
