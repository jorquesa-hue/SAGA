import { useEffect } from "react";
import { useClient } from "../session.js";
import { LOCALES, hasStoredLocalePreference, useI18n, type Locale } from "../i18n/index.js";

/**
 * Adopts the signed-in tenant's configured settings (§45): the base currency
 * drives money formatting across the console, and the base locale seeds the
 * language on first visit. A currency is a property of the tenant's books, so
 * every client organization effectively "chooses" the currency their amounts
 * are shown in. The user's own language toggle still wins — the tenant locale
 * only applies when they have not chosen one. Renders nothing.
 */
export function TenantSettingsLoader(): null {
  const client = useClient();
  const { setCurrency, setLocale } = useI18n();

  useEffect(() => {
    let active = true;
    void client.tenants
      .current()
      .then((tenant) => {
        if (!active) return;
        if (tenant.defaultCurrency) setCurrency(tenant.defaultCurrency);
        const loc = tenant.defaultLocale;
        if (loc && !hasStoredLocalePreference() && LOCALES.some((l) => l.value === loc)) {
          setLocale(loc as Locale);
        }
      })
      .catch(() => {
        /* Non-fatal: fall back to the built-in defaults (pt-BR / BRL). */
      });
    return () => {
      active = false;
    };
  }, [client, setCurrency, setLocale]);

  return null;
}
