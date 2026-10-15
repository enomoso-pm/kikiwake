// 「保存…」の窓（2026-09-29 決定: 保存の帯には「保存…」だけを置き、形式と保存先はここで選ぶ）。
// 選んだ形式と保存先は覚えておき、次に開いたとき（ほかの録音でも）初めから入れておく（store/savePrefs）。
// 保存先は「元のファイルと同じフォルダ」（既定。録音ごとに変わる）・前に選んだフォルダ・「ほかのフォルダを選ぶ…」（Mac のフォルダを選ぶ画面）。
// ファイルは選んだフォルダにそのまま、録音の名前入りで書く（約束 版12。「定例会議_0926_文字起こし.md」）
import { useEffect, useId, useRef, useState } from "react";
import type { SaveFormat, ScreensInfo } from "@contract/types";
import { api } from "../../api";
import { useT } from "../../i18n";
import { folderLabel } from "../../lib/format";
import { isEscape } from "../../lib/keys";
import { SAVE_FORMATS, loadSavePrefs, storeSavePrefs } from "../../store/savePrefs";

type Place = "source" | "recent";

/**
 * sourceDir: 元のファイルと同じフォルダ（エンジンが返す既定の保存先）。
 * sourceGone: 元のファイルのフォルダが無いので、エンジンが書類フォルダを返した（「元のファイルと同じ」とは書かない）。
 * screens: 版13。マニュアル用にした録音の画面の絵の数（無ければ「マニュアルの素材」を出さない）。
 * onSave: 選んだ保存先と形式で保存する（覚えるのはこの窓が行う。zip は覚えない）
 */
export function SaveDialog({
  sourceDir,
  sourceGone = false,
  screens = null,
  onCancel,
  onSave,
}: {
  sourceDir: string;
  sourceGone?: boolean;
  screens?: ScreensInfo | null;
  onCancel: () => void;
  onSave: (dir: string, formats: SaveFormat[], zip: boolean) => void;
}) {
  const t = useT();
  const s = t.save;
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const [initial] = useState(loadSavePrefs);
  const [formats, setFormats] = useState<SaveFormat[]>(initial.formats);
  const [recent, setRecent] = useState<string | null>(initial.recent);
  const [place, setPlace] = useState<Place>(initial.dir ? "recent" : "source");
  const [picking, setPicking] = useState(false);
  // 版13: マニュアルの素材（.zip）。毎回外れた状態で開き、選んだときだけ保存する（2026-10-12 決定）
  const [zip, setZip] = useState(false);
  const zipOk = Boolean(screens && screens.frames > 0 && !screens.error);
  const wantZip = zip && zipOk;

  // 開いたら「保存」に（Enter でそのまま保存できる）
  useEffect(() => {
    saveRef.current?.focus();
  }, []);

  // Esc で閉じる。Tab は窓の中だけで回す（フォルダを選ぶ画面が出ている間は何もしない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEscape(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (!picking) onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...(boxRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)") ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      items[next].focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, picking]);

  const toggle = (f: SaveFormat) =>
    setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : SAVE_FORMATS.filter((x) => x === f || cur.includes(x))));

  const dir = place === "recent" && recent ? recent : sourceDir;

  const pickFolder = async () => {
    setPicking(true);
    try {
      const picked = await api.pickFolder(dir || undefined);
      if (picked) {
        setRecent(picked);
        setPlace("recent");
      }
    } catch {
      // 選べなかったときは今のまま
    } finally {
      setPicking(false);
    }
  };

  const confirm = () => {
    if ((!formats.length && !wantZip) || !dir || picking) return;
    // zip だけを保存したときは、覚えている形式をそのままにする
    storeSavePrefs({ formats: formats.length ? formats : initial.formats, dir: place === "recent" ? recent : null, recent });
    onSave(dir, formats, wantZip);
  };

  return (
    <div className="scrim">
      <div ref={boxRef} className="dialog save-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span id={titleId} className="dialog-title">
          {s.title}
        </span>
        <div className="save-field" role="group" aria-label={s.formats}>
          <span className="save-label">{s.formats}</span>
          <div className="save-formats">
            {SAVE_FORMATS.map((f) => {
              const on = formats.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={`save-format${on ? " on" : ""}`}
                  onClick={() => toggle(f)}
                >
                  <span className="check-box">{on ? "✓" : ""}</span>
                  <span className="save-format-ext">.{f}</span>
                  <span className="save-format-hint">{s.formatHint[f]}</span>
                </button>
              );
            })}
          </div>
        </div>
        {screens ? (
          <div className="save-field" role="group" aria-label={s.zipTitle}>
            <span className="save-label">{s.zipTitle}</span>
            <div className="save-formats">
              <button
                type="button"
                role="checkbox"
                aria-checked={wantZip}
                disabled={!zipOk}
                className={`save-format${wantZip ? " on" : ""}`}
                onClick={() => setZip(!zip)}
              >
                <span className="check-box">{wantZip ? "✓" : ""}</span>
                <span className="save-format-ext">.zip</span>
                <span className="save-format-hint">{zipOk ? s.zipHint(screens.frames) : screens.error ? s.zipError : s.zipNone}</span>
              </button>
            </div>
            {wantZip && screens.faces > 0 ? <span className="save-note pretty">{s.zipFaces(screens.faces)}</span> : null}
          </div>
        ) : null}
        <label className="save-field">
          <span className="save-label">{s.folder}</span>
          {/* 「ほかのフォルダを選ぶ…」は選んでも値にしない（フォルダを選ぶ画面を開き、選べたら前に選んだフォルダとして入れる） */}
          <select
            className="save-folder"
            value={place}
            title={dir}
            disabled={picking}
            onChange={(e) => {
              if (e.target.value === "pick") void pickFolder();
              else setPlace(e.target.value as Place);
            }}
          >
            <option value="source">
              {(sourceGone ? s.sourceFolderGone : s.sameAsSource)(folderLabel(sourceDir, s.homeFolders))}
            </option>
            {recent ? <option value="recent">{folderLabel(recent, s.homeFolders)}</option> : null}
            <option value="pick">{s.pickOther}</option>
          </select>
        </label>
        <div className="dialog-buttons">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {s.cancel}
          </button>
          <button
            ref={saveRef}
            type="button"
            className="btn btn-primary"
            disabled={(!formats.length && !wantZip) || picking}
            onClick={confirm}
          >
            {s.save}
          </button>
        </div>
      </div>
    </div>
  );
}
