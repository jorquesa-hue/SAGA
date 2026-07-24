import { useEffect, useState } from "react";
import { useClient } from "../session.js";
import { LOCALES, useI18n, type Locale } from "../i18n/index.js";
import { useAsync } from "../use-async.js";
import { FormMessage, SelectField, useCommand } from "../components/Form.js";

/** Currencies offered in the picker (ISO 4217). BRL first (reference market). */
const CURRENCIES = ["BRL", "USD", "EUR", "GBP", "ARS", "PYG", "UYU", "CLP", "COP", "MXN", "PEN", "BOB"];

/** Full language names shown in the picker, keyed by app locale. */
const LOCALE_NAMES: Record<Locale, string> = {
  "pt-BR": "Português (Brasil)",
  en: "English",
  es: "Español",
};

/**
 * Tenant settings (§45): the organization owner sets the base language and
 * currency. Saving persists to the tenant and immediately re-applies to the
 * live console. The API authorizes the write (manage_tenant → tenant_owner);
 * a non-owner sees the server's forbidden reason.
 */
export function Settings(): JSX.Element {
  const client = useClient();
  const { t, locale, setLocale, setCurrency } = useI18n();
  const tenant = useAsync(() => client.tenants.current(), []);
  const cmd = useCommand();

  const [lang, setLang] = useState<Locale>(locale);
  const [currency, setCur] = useState<string>("");

  // Seed the form from the tenant's stored settings once loaded.
  useEffect(() => {
    if (tenant.data?.defaultCurrency) setCur(tenant.data.defaultCurrency);
    if (tenant.data?.defaultLocale && LOCALES.some((l) => l.value === tenant.data!.defaultLocale)) {
      setLang(tenant.data.defaultLocale as Locale);
    }
  }, [tenant.data]);

  const currencyName = (code: string): string => {
    try {
      const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
      return name && name !== code ? `${code} — ${name}` : code;
    } catch {
      return code;
    }
  };

  const save = (): void => {
    void cmd.run(async () => {
      const updated = await client.tenants.updateSettings({ defaultLocale: lang, defaultCurrency: currency });
      // Re-apply live so the change is visible immediately across the console.
      if (updated.defaultCurrency) setCurrency(updated.defaultCurrency);
      if (updated.defaultLocale && LOCALES.some((l) => l.value === updated.defaultLocale)) {
        setLocale(updated.defaultLocale as Locale);
      }
      tenant.reload();
    }, t("settings.saved"));
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("settings.title")}</h2>
      </div>
      <p className="muted">{t("settings.subtitle")}</p>

      {tenant.loading && <p className="muted">{t("common.loading")}</p>}
      {tenant.error && <p className="error">{tenant.error}</p>}

      <div className="form" style={{ maxWidth: 480 }}>
        {tenant.data && (
          <p className="hint">
            {t("settings.org")}: <strong>{tenant.data.name}</strong>
          </p>
        )}
        <SelectField
          label={t("settings.language")}
          value={lang}
          onChange={(v) => setLang(v as Locale)}
          options={LOCALES.map((l) => ({ value: l.value, label: LOCALE_NAMES[l.value] }))}
        />
        <SelectField
          label={t("settings.currency")}
          value={currency}
          onChange={setCur}
          options={CURRENCIES.map((c) => ({ value: c, label: currencyName(c) }))}
        />
        <p className="muted">{t("settings.hint")}</p>
        <button type="button" disabled={cmd.busy || !currency} onClick={save}>
          {t("settings.save")}
        </button>
        <FormMessage state={cmd} />
      </div>
    </section>
  );
}
