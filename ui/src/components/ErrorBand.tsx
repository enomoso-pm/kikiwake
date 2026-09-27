// エラーの帯（UI 画面仕様書 §2.4）。AppError.message をそのまま出し、右に「詳細をコピー」
// （ファイル選択の非対応の帯は仕様書 §5.2 のとおり文だけ。copy={false}）
import type { CSSProperties } from "react";
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
  return (
    <div
      className="band-error"
      role="alert"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: small ? "10px 14px" : "12px 16px",
        borderRadius: small ? 6 : 8,
        ...style,
      }}
    >
      <span className="pretty" style={{ fontSize: small ? 13 : 14, lineHeight: 1.6 }}>
        {t.engine.error(error)}
      </span>
      {copy ? (
        <button type="button" className="btn-copy" onClick={() => void copyErrorDetail(error)}>
          {t.common.copyDetail}
        </button>
      ) : null}
    </div>
  );
}
