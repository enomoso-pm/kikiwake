// エラーの帯（UI 画面仕様書 §2.4）。AppError.message をそのまま出し、右に「詳細をコピー」と「×」（閉じる）
// （ファイル選択の非対応の帯は仕様書 §5.2 のとおり文だけ。copy={false}）
import { useState, type CSSProperties } from "react";
import type { AppError } from "@contract/types";
import { useT } from "../i18n";
import { copyErrorDetail } from "../store/ui";

export function ErrorBand({
  error,
  small = false,
  copy = true,
  style,
}: {
  error: AppError;
  small?: boolean;
  copy?: boolean;
  style?: CSSProperties;
}) {
  const t = useT();
  // 「×」で閉じる（2026-09-29。閉じられないと困るため）。同じエラーの間は閉じたまま、新しいエラーが来たらまた出す
  const [closed, setClosed] = useState<AppError | null>(null);
  if (closed === error) return null;
  return (
    <div
      className="band-error"
      role="alert"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: small ? "10px 10px 10px 14px" : "12px 12px 12px 16px",
        borderRadius: small ? 6 : 8,
        ...style,
      }}
    >
      <span className="pretty" style={{ fontSize: small ? 13 : 14, lineHeight: 1.6 }}>
        {t.engine.error(error)}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
        {copy ? (
          <button type="button" className="btn-copy" onClick={() => void copyErrorDetail(error)}>
            {t.common.copyDetail}
          </button>
        ) : null}
        <button type="button" className="btn-close-band" title={t.common.close} aria-label={t.common.close} onClick={() => setClosed(error)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.6 2.6l6.8 6.8M9.4 2.6l-6.8 6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </div>
  );
}
