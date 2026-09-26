import { useApp } from "../store/state";

/** トースト（UI 画面仕様書 §2.6） */
export function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className="toast" role="status">
      {toast.text}
    </div>
  );
}
