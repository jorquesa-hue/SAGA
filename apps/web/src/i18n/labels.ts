/**
 * Shared label resolution for screens that render whatever shape the API
 * returns (the executive dashboard, the animal reproduction summary).
 *
 * docs/brand §2.3: name things by what people recognise, not by how the
 * system is built. A key path is never acceptable on screen, so resolution
 * degrades in steps rather than falling back to the raw key.
 */

/** Translate-or-key function, matching `useI18n().t`. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Data-value translator, matching `useI18n().td`. */
type TranslateData = (value: unknown) => string;

/**
 * `nutrition.openOrders` → `Nutrition · open orders`. Readable enough to ship
 * while a translation is added, and never a bare key path.
 */
export function humanizeKey(key: string): string {
  return key
    .split(".")
    .map((part, index) => {
      const words = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
      return index === 0 ? words.charAt(0).toUpperCase() + words.slice(1) : words;
    })
    .join(" · ");
}

/**
 * Resolves a metric key to a human label under `namespace`:
 *
 *   1. an exact translation (`<namespace>.<key>`);
 *   2. for a dynamic group whose leaf is an enum (`herd.byStatus.active`),
 *      the translated group plus the translated leaf, so a new status needs
 *      no code change;
 *   3. a humanised key.
 */
export function metricLabel(
  namespace: string,
  key: string,
  t: Translate,
  td: TranslateData,
): string {
  const exactKey = `${namespace}.${key}`;
  const exact = t(exactKey);
  if (exact !== exactKey) return exact;

  const lastDot = key.lastIndexOf(".");
  if (lastDot > 0) {
    const groupKey = `${namespace}.${key.slice(0, lastDot)}`;
    const group = t(groupKey);
    if (group !== groupKey) return `${group} · ${td(key.slice(lastDot + 1))}`;
  }
  return humanizeKey(key);
}

/**
 * docs/brand §3.3 reserves the monospace face for figures — identifiers,
 * weights, currency and dates — so prose is not forced into a numeric column.
 */
export function isFigure(value: unknown): boolean {
  if (typeof value === "number") return true;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}
