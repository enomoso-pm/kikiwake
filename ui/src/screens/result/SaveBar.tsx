// 下の帯（保存。UI 画面仕様書 §8.9）。保存ボタンは右下で、名前付けの主ボタンと同じ位置。
// 2026-09-29 決定（「保存周りの情報が多すぎる」という指摘から）: 帯には「保存…」だけを置く。形式と保存先は押して開く窓（SaveDialog）で選び、
// 次からも同じにする。「保存しました」は状態の印と知らせ（トースト）で、「Finder で表示」は左の一覧の行の「…」で
import { useT } from "../../i18n";
import { useApp } from "../../store/state";

/** onOpen: 「保存…」の窓を開く */
export function SaveBar({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const saving = useApp((s) => s.saving);

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "14px 32px",
        borderTop: "1px solid var(--line)",
        background: "var(--bg-bar)",
      }}
    >
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onOpen}>
        {saving ? t.save.saving : t.save.open}
      </button>
    </div>
  );
}
