import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Dashboard } from "../src/pages/Dashboard.js";
import { I18nProvider, type Locale } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";
import { messages } from "../src/i18n/messages.js";
import { metricLabel } from "../src/i18n/labels.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

/** The shape farm-intelligence returns, including its two dynamic groups. */
const payload = {
  farmId: null,
  herd: { active: 16, byStatus: { active: 16, sold: 3 } },
  reproduction: { pregnant: 4, served: 9 },
  health: { activeRestrictions: 0, openCases: 2 },
  alerts: { open: 1, bySeverity: { high: 1 } },
  farmIntelligenceIndex: 96.3,
  calculatedAt: "2026-07-25T12:00:00.000Z",
  // A key the catalogue does not know yet — must still read as words.
  nutrition: { openOrders: 5 },
};

function renderDashboard(locale: Locale) {
  const fetch: FetchLike = async () => ({
    status: 200,
    headers: { get: () => "c" },
    text: async () => JSON.stringify(payload),
  });
  const client = new JkPlatformClient({
    baseUrl: "http://api.test",
    tenantId: "t",
    auth: { mode: "none" },
    fetch,
  });
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale={locale}>
        <SessionProvider initialSession={session} clientFactory={() => client}>
          <Dashboard />
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

/**
 * docs/brand §2.3 — a rancher reads these tiles, so they must carry names,
 * not the API's key paths. These tests pin all four resolution paths.
 */
describe("dashboard KPI labels", () => {
  it("names known metrics in pt-BR instead of showing key paths", async () => {
    renderDashboard("pt-BR");
    expect(await screen.findByText("Rebanho ativo")).toBeInTheDocument();
    expect(screen.getByText("Casos clínicos abertos")).toBeInTheDocument();
    expect(screen.getByText("Índice de inteligência")).toBeInTheDocument();
    expect(screen.getByText("Calculado em")).toBeInTheDocument();
  });

  it("never renders a raw dotted key path as a label", async () => {
    const { container } = renderDashboard("pt-BR");
    await screen.findByText("Rebanho ativo");
    const labels = [...container.querySelectorAll(".kpi-label")].map(
      (n) => n.textContent ?? "",
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const text of labels) {
      expect(text, `"${text}" looks like a raw key`).not.toMatch(
        /^[a-z]+(\.[a-zA-Z]+)+$/,
      );
      expect(text, `"${text}" leaks a translation key`).not.toContain("dashboard.kpi.");
    }
  });

  it("renders a distribution as a chart, not one tile per category", async () => {
    const { container } = renderDashboard("pt-BR");
    const caption = await screen.findByText("Rebanho por situação");
    const figure = caption.closest("figure")!;

    // Both distributions render; this one has two categories.
    expect(container.querySelectorAll("figure.dist")).toHaveLength(2);
    expect(figure.querySelectorAll(".dist-row")).toHaveLength(2);

    // Identity is carried by a translated label, never colour alone.
    const names = [...figure.querySelectorAll(".dist-name")].map((n) => n.textContent);
    expect(names).not.toContain("active");
    expect(names).not.toContain("sold");

    // Series colours come from the validated palette in fixed order.
    const bars = [...figure.querySelectorAll<HTMLElement>(".dist-bar")];
    expect(bars[0]?.style.background).toContain("--saga-series-1");
    expect(bars[1]?.style.background).toContain("--saga-series-2");
  });

  it("still labels a dynamic enum group where one is rendered as tiles", () => {
    // The helper backs the animal reproduction summary too, so the group path
    // is exercised directly rather than through the dashboard's charts.
    const t = (key: string) => (key === "x.herd.byStatus" ? "Rebanho por situação" : key);
    const td = (v: unknown) => (v === "active" ? "Ativo" : String(v));
    expect(metricLabel("x", "herd.byStatus.active", t, td)).toBe(
      "Rebanho por situação · Ativo",
    );
    expect(metricLabel("x", "nutrition.openOrders", t, td)).toBe(
      "Nutrition · open orders",
    );
  });

  it("humanises a metric the catalogue does not know yet", async () => {
    renderDashboard("pt-BR");
    // nutrition.openOrders has no entry; it must still read as words.
    expect(await screen.findByText("Nutrition · open orders")).toBeInTheDocument();
  });

  it("shows a null farm as 'all farms' rather than an em dash", async () => {
    renderDashboard("pt-BR");
    expect(await screen.findByText("Todas as fazendas")).toBeInTheDocument();
  });

  it("translates the labels in English and Spanish", async () => {
    const en = renderDashboard("en");
    expect(await screen.findByText("Active herd")).toBeInTheDocument();
    expect(screen.getByText("Open health cases")).toBeInTheDocument();
    en.unmount();

    renderDashboard("es");
    expect(await screen.findByText("Rodeo activo")).toBeInTheDocument();
    expect(screen.getByText("Casos clínicos abiertos")).toBeInTheDocument();
  });

  it("keeps every locale at key parity", () => {
    const locales = Object.keys(messages) as Locale[];
    const reference = Object.keys(messages["pt-BR"]).sort();
    for (const locale of locales) {
      expect(
        Object.keys(messages[locale]).sort(),
        `${locale} differs from pt-BR`,
      ).toEqual(reference);
    }
  });
});
