import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n, type Locale } from "../src/i18n/index.js";

/** Probe that renders the locale-aware formatters' output. */
function Probe(): JSX.Element {
  const { fmt } = useI18n();
  return (
    <ul>
      <li data-testid="num">{fmt.number(1234567.5)}</li>
      <li data-testid="cur">{fmt.currency(1250)}</li>
      <li data-testid="date">{fmt.date("2024-05-01")}</li>
      <li data-testid="passthrough">{fmt.number("BR-0100")}</li>
      <li data-testid="empty">{fmt.date(null)}</li>
    </ul>
  );
}

function textAt(id: string): string {
  return screen.getByTestId(id).textContent ?? "";
}

function renderIn(locale: Locale) {
  return render(
    <I18nProvider initialLocale={locale}>
      <Probe />
    </I18nProvider>,
  );
}

describe("i18n number/date/currency formatting", () => {
  it("groups numbers per locale", () => {
    const { unmount } = renderIn("pt-BR");
    expect(textAt("num")).toBe("1.234.567,5"); // pt-BR: dot thousands, comma decimal
    unmount();
    renderIn("en");
    expect(textAt("num")).toBe("1,234,567.5"); // en: comma thousands, dot decimal
  });

  it("formats currency (BRL) with locale grouping, keeping the currency", () => {
    const { unmount } = renderIn("pt-BR");
    expect(textAt("cur")).toContain("1.250,00");
    expect(textAt("cur")).toContain("R$");
    unmount();
    renderIn("en");
    expect(textAt("cur")).toContain("1,250.00");
    expect(textAt("cur")).toContain("R$");
  });

  it("formats ISO dates per locale (not the raw string)", () => {
    const { unmount } = renderIn("en");
    expect(textAt("date")).toBe("May 1, 2024");
    unmount();
    renderIn("pt-BR");
    const pt = textAt("date");
    expect(pt).not.toBe("2024-05-01");
    expect(pt).toContain("2024");
    expect(pt).not.toBe("May 1, 2024"); // locale actually changes the output
  });

  it("passes free-form/empty values through safely", () => {
    renderIn("es");
    expect(textAt("passthrough")).toBe("BR-0100"); // non-numeric string is untouched
    expect(textAt("empty")).toBe("—"); // null date → em dash
  });
});
