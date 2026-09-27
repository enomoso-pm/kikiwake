// 新しい版の帯（約束 版10。2026-09-27 決定）: 新しい録音の画面の上に出す。押すと更新内容と手順の窓（UpdateDialog）。
// 「この版は知らせない」で、その版の帯を出さない（次の版はまた知らせる）
import { useT } from "../i18n";
import { openUpdate, skipUpdate } from "../store/update";
import { useApp } from "../store/state";

export function UpdateBand() {
  const t = useT();
  const update = useApp((s) => s.update);
  const dismissed = useApp((s) => s.updateDismissed);
  if (!update || update.version === dismissed) return null;
  return (
    <div className="band-info" data-update-band="" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px" }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{t.update.band(update.version)}</span>
      <span className="pretty" style={{ fontSize: 13, lineHeight: 1.6 }}>
        {t.update.bandSub}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn btn-small" onClick={openUpdate}>
          {t.update.show}
        </button>
        <button type="button" className="btn btn-small" onClick={skipUpdate}>
          {t.update.skip}
        </button>
      </div>
    </div>
  );
}
