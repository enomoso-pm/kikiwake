// 画面の言語。文字は言語ごとの辞書（ja.ts・en.ts）に置き、画面は useT()、画面の外（store・lib）は getT() で読む。
// 初めの言語は、前に選んだ言語 → この PC の言語（日本語なら日本語、それ以外は英語）。工程バーの右端で切り替えられ、選んだ言語を覚える（2026-09-27 決定）。
// 言語を足すときは、ja.ts と同じ形の辞書を1つ足して LOCALES と MESSAGES に並べる（形が違えば型チェックで止まる）。
import { create } from "zustand";
import { en } from "./en";
import { ja, type Messages } from "./ja";

export type { Messages } from "./ja";

export type Locale = "ja" | "en";

/** 切り替えに並べる言語。名前はその言語自身の書き方 */
export const LOCALES: ReadonlyArray<{ id: Locale; name: string }> = [
  { id: "ja", name: "日本語" },
  { id: "en", name: "English" },
];

const MESSAGES: Record<Locale, Messages> = { ja, en };
const STORAGE_KEY = "kikiwake.locale";

const isLocale = (v: unknown): v is Locale => v === "ja" || v === "en";

/** 初めの言語。ブラウザ・アプリの外（テストなど）では日本語 */
export function initialLocale(): Locale {
  if (typeof window === "undefined") return "ja";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // 覚えておけない所（読めない設定）では、この PC の言語で決める
  }
  const first = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  return first.startsWith("ja") ? "ja" : "en";
}

export const useLocale = create<{ locale: Locale }>(() => ({ locale: initialLocale() }));

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
applyDocumentLang(useLocale.getState().locale);

export function getLocale(): Locale {
  return useLocale.getState().locale;
}

/** 言語を切り替えて覚える */
export function setLocale(locale: Locale): void {
  useLocale.setState({ locale });
  applyDocumentLang(locale);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 覚えておけない所では、この回だけ切り替える
  }
}

/** 画面の部品から: 今の言語の辞書（言語が変わると描き直す） */
export function useT(): Messages {
  return MESSAGES[useLocale((s) => s.locale)];
}

/** 画面の外（store・lib）から: 今の言語の辞書 */
export function getT(): Messages {
  return MESSAGES[getLocale()];
}
