// 表示の言語の切り替え（右の一番上の帯の右端。2026-09-27 決定）。帯の中の部品を動かさないよう、窓に対して重ねて置く（.lang-switch）
import { LOCALES, setLocale, useLocale, useT, type Locale } from "../i18n";

export function LanguageSwitch() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  return (
    <select
      data-i18n-switch=""
      className="lang-switch"
      value={locale}
      aria-label={t.lang.label}
      title={t.lang.label}
      onChange={(e) => setLocale(e.target.value as Locale)}
    >
      {LOCALES.map((l) => (
        <option key={l.id} value={l.id} lang={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
