// 完了の画面（2026-09-26 決定。仕様書に無い）。準備と同じく工程の外。
// 結果の画面の右上の「完了」から来る（保存したかどうかに関係なく押せる）。別の録音へ移るか、Kikiwake を終了する。
// 部品はファイルの画面のカード（左に名前、右にボタン）・帯と、結果の画面の「← 名前付けに戻る」と同じ形
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
            ← 文字起こしに戻る
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>{savedAll ? "文字起こしを保存しました" : "文字起こしを終えました"}</h1>
          <p className="pretty" style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.75 }}>
            続けて別の録音を文字起こしするか、Kikiwake を終了できます。
          </p>
        </div>

        <div
          className="card"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 20px" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600, overflowWrap: "anywhere" }}>{name}</span>
            <span style={{ fontSize: 13, color: "var(--ink-3)", overflowWrap: "anywhere" }}>
              {files.length ? files.map(basename).join("・") : "保存していません"}
            </span>
            {files.length ? (
              <span className="mono ellipsis" title={folderOf(files[0])} style={{ fontSize: 12, color: "var(--ink-4)" }}>
                {folderOf(files[0])}
              </span>
            ) : null}
          </div>
          {files.length ? (
            <button type="button" className="btn btn-mid" onClick={() => void revealSaved()}>
              {isMac ? "Finder で表示" : "エクスプローラーで表示"}
            </button>
          ) : null}
        </div>

        {unsaved ? (
          <div className="band-warn" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>保存していない手直しがあります</span>
            <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
              このまま別の録音へ移るか終了すると、直した内容（行の名前・確認用の確定・文字）は消えます。先に保存するときは「← 文字起こしに戻る」から。
            </span>
          </div>
        ) : !files.length ? (
          <div className="band-info" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>まだ保存していません</span>
            <span className="pretty" style={{ fontSize: 13, lineHeight: 1.7 }}>
              保存しなくても、同じ録音をもう一度選べば、書き起こしをやり直さずにこの結果へすぐ戻れます{named ? "（付けた名前も入っています）" : ""}。
              ファイルに残すときは「← 文字起こしに戻る」から保存してください。
            </span>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={requestNewRecording}>
            別の録音を文字起こしする
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void requestQuit()}>
            Kikiwake を終了
          </button>
        </div>
      </div>
    </div>
  );
}
