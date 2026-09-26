import type { AppError } from "@contract/types";

const FALLBACK_MESSAGE = "処理の途中で問題が起きました。続く場合は、詳細をコピーして連絡してください。";

function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as AppError).code === "string" &&
    typeof (e as AppError).message === "string"
  );
}

/** api から返った失敗を AppError にそろえる（エンジンは AppError を返す約束。それ以外は詳細に入れる） */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof Error) {
    return { code: "engine_failed", message: FALLBACK_MESSAGE, detail: `${e.name}: ${e.message}\n${e.stack ?? ""}`.trim() };
  }
  return { code: "engine_failed", message: FALLBACK_MESSAGE, detail: typeof e === "string" ? e : JSON.stringify(e) };
}

/** 「詳細をコピー」で渡す文 */
export function errorDetailText(e: AppError): string {
  return e.detail ?? `${e.code}: ${e.message}`;
}
