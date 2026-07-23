import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { LOCALES, messages, type Locale } from "./messages.js";

export type { Locale } from "./messages.js";
export { LOCALES } from "./messages.js";

const STORAGE_KEY = "jk.locale.v1";
const DEFAULT_LOCALE: Locale = "pt-BR";

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue | null>(null);

function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && LOCALES.some((l) => l.value === raw) ? (raw as Locale) : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? loadLocale());

  const value = useMemo<I18nValue>(() => {
    const dict = messages[locale];
    return {
      locale,
      setLocale: (l) => {
        try {
          localStorage.setItem(STORAGE_KEY, l);
        } catch {
          /* ignore persistence errors */
        }
        setLocaleState(l);
      },
      // Fall back to the pt-BR value, then the key, so a missing translation
      // never renders blank while page bodies are converted incrementally.
      t: (key, vars) => interpolate(dict[key] ?? messages["pt-BR"][key] ?? key, vars),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const DEFAULT_VALUE: I18nValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => interpolate(messages[DEFAULT_LOCALE][key] ?? key, vars),
};

/**
 * Returns the active i18n context, or a pt-BR default when rendered outside a
 * provider (e.g. an isolated component test). The app always mounts a provider,
 * so the toggle is live in production; tests default to pt-BR without extra
 * wrapping.
 */
export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? DEFAULT_VALUE;
}
