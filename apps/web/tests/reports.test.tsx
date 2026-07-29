import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Reports } from "../src/pages/Reports.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

const COLUMNS = [
  { key: "entryType", labelKey: "reporting.col.entryType", type: "enum" },
  { key: "category", labelKey: "reporting.col.category", type: "enum" },
  { key: "totalMinor", labelKey: "reporting.col.total", type: "money" },
];

const CATALOG = {
  items: [
    {
      key: "finance.pl",
      category: "finance",
      titleKey: "reporting.report.finance.pl.title",
      descriptionKey: "reporting.report.finance.pl.desc",
      params: [
        { key: "dateFrom", kind: "dateFrom", labelKey: "reporting.param.dateFrom" },
        { key: "dateTo", kind: "dateTo", labelKey: "reporting.param.dateTo" },
      ],
      columns: COLUMNS,
    },
  ],
};

const PREVIEW = {
  reportKey: "finance.pl",
  category: "finance",
  titleKey: "reporting.report.finance.pl.title",
  columns: COLUMNS,
  params: {},
  rows: [{ entryType: "revenue", category: "cattle_sale", totalMinor: 500000 }],
  summary: { currency: "BRL", totalRevenueMinor: 500000, marginMinor: 380000 },
  rowCount: 1,
};

function client(): JkPlatformClient {
  const fetch: FetchLike = async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    let body: unknown = {};
    if (path === "/api/v1/reporting/reports") body = CATALOG;
    else if (path.endsWith("/preview")) body = PREVIEW;
    else if (path === "/api/v1/reporting/runs") body = { items: [] };
    return {
      status: 200,
      headers: { get: () => "c" },
      text: async () => JSON.stringify(body),
    };
  };
  return new JkPlatformClient({
    baseUrl: "http://api.test",
    tenantId: "t",
    auth: { mode: "none" },
    fetch,
  });
}

function renderWith(node: JSX.Element, c: JkPlatformClient) {
  return render(
    <MemoryRouter>
      <SessionProvider initialSession={session} clientFactory={() => c}>
        {node}
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("Reports page", () => {
  it("lists the catalogue, previews a report, and renders money in currency", async () => {
    renderWith(<Reports />, client());
    // The catalogue button appears (pt-BR title).
    await waitFor(() =>
      expect(screen.getByText("Resultado (receita × despesa)")).toBeInTheDocument(),
    );
    // Selecting the report reveals its parameters and the view action.
    fireEvent.click(screen.getByText("Resultado (receita × despesa)"));
    const view = await screen.findByText("Ver relatório");
    fireEvent.click(view);
    // The money column and summary are formatted as BRL (minor units / 100).
    await waitFor(() =>
      expect(screen.getAllByText(/R\$\s?5\.000,00/).length).toBeGreaterThan(0),
    );
    // The margin summary is present and localized.
    expect(screen.getByText("Margem")).toBeInTheDocument();
  });
});
