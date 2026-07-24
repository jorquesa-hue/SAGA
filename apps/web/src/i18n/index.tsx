import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { LOCALES, messages, type Locale } from "./messages.js";
import { enumLabels } from "./enums.js";

export type { Locale } from "./messages.js";
export { LOCALES } from "./messages.js";

const STORAGE_KEY = "jk.locale.v1";
const DEFAULT_LOCALE: Locale = "pt-BR";

/**
 * Currency is a property of the money, not of the reader's language: a BRL
 * amount is shown as BRL to every user, only the grouping/symbol placement
 * follows the locale. The reference operation is Brazilian, so BRL is the
 * default; call sites pass an explicit ISO 4217 code when the datum carries one.
 */
const DEFAULT_CURRENCY = "BRL";

/** Map each app locale to a BCP-47 tag for the Intl formatters. */
const BCP47: Record<Locale, string> = { "pt-BR": "pt-BR", en: "en-US", es: "es-ES" };

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;
/** Translate a raw data/enum value (falls back to the raw string). */
export type TranslateDataFn = (value: unknown) => string;

export interface Formatters {
  /** Locale-grouped number (e.g. 1.234,5 in pt-BR, 1,234.5 in en). */
  number: (value: unknown, opts?: Intl.NumberFormatOptions) => string;
  /** Currency amount; `currency` defaults to BRL. Symbol/placement follow the locale. */
  currency: (value: unknown, currency?: string) => string;
  /** Medium date (no time). Non-dates pass through; null → em dash. */
  date: (value: unknown) => string;
  /** Medium date + short time. */
  dateTime: (value: unknown) => string;
  /** Best-effort: ISO date → date, finite number → number, else the raw string. */
  auto: (value: unknown) => string;
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Active default currency (ISO 4217) used by fmt.currency when no code is passed. */
  currency: string;
  /** Set the default currency — the app seeds this from the tenant's configured currency. */
  setCurrency: (c: string) => void;
  t: TranslateFn;
  td: TranslateDataFn;
  fmt: Formatters;
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

/** True when the user has explicitly chosen a locale (so the tenant default must not override it). */
export function hasStoredLocalePreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Map a raw data value (e.g. "dead_letter", "female", "pending") to a localized
 * label. Free-form values with no catalog entry (breed codes, names, typed
 * categories) pass through unchanged, and null/undefined render as an em dash —
 * so a value is never blank.
 */
function translateData(locale: Locale, value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = String(value);
  return enumLabels[locale][s] ?? enumLabels[DEFAULT_LOCALE][s] ?? s;
}

// Accepts full ISO datetimes and bare YYYY-MM-DD dates (the shapes the API emits).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/;

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildFormatters(locale: Locale, defaultCurrency: string): Formatters {
  const tag = BCP47[locale];
  const dateFmt = new Intl.DateTimeFormat(tag, { dateStyle: "medium" });
  const dateTimeFmt = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });

  const number = (value: unknown, opts?: Intl.NumberFormatOptions): string => {
    if (value === null || value === undefined || value === "") return "—";
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat(tag, opts).format(n) : String(value);
  };

  const currency = (value: unknown, cur: string = defaultCurrency): string => {
    if (value === null || value === undefined || value === "") return "—";
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat(tag, { style: "currency", currency: cur }).format(n) : String(value);
  };

  const date = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    const d = toDate(value);
    return d ? dateFmt.format(d) : String(value);
  };

  const dateTime = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    const d = toDate(value);
    return d ? dateTimeFmt.format(d) : String(value);
  };

  const auto = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    const d = toDate(value);
    if (d) return dateFmt.format(d);
    if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) {
      return number(value);
    }
    return String(value);
  };

  return { number, currency, date, dateTime, auto };
}

export function I18nProvider({
  children,
  initialLocale,
  initialCurrency,
}: {
  children: ReactNode;
  initialLocale?: Locale;
  initialCurrency?: string;
}): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? loadLocale());
  const [currency, setCurrencyState] = useState<string>(() => initialCurrency ?? DEFAULT_CURRENCY);

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
      currency,
      setCurrency: (c) => setCurrencyState(c),
      // Fall back to the pt-BR value, then the key, so a missing translation
      // never renders blank while page bodies are converted incrementally.
      t: (key, vars) => interpolate(dict[key] ?? messages["pt-BR"][key] ?? key, vars),
      td: (v) => translateData(locale, v),
      fmt: buildFormatters(locale, currency),
    };
  }, [locale, currency]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const DEFAULT_VALUE: I18nValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  currency: DEFAULT_CURRENCY,
  setCurrency: () => {},
  t: (key, vars) => interpolate(messages[DEFAULT_LOCALE][key] ?? key, vars),
  td: (v) => translateData(DEFAULT_LOCALE, v),
  fmt: buildFormatters(DEFAULT_LOCALE, DEFAULT_CURRENCY),
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
