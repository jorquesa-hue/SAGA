import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LotDetail } from "../src/pages/LotDetail.js";
import { I18nProvider } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function client(): JkPlatformClient {
  const fetch: FetchLike = async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    let body: unknown = { items: [] };
    if (path.endsWith("/current-paddock")) body = { paddockName: "Piquete 3" };
    else if (path.endsWith("/members")) body = { items: [{ animalId: "an-1", status: "active" }] };
    else if (path.endsWith("/margin")) body = { revenue: "8200.00", cost: "5000.00", margin: "3200.00", currency: "USD" };
    return { status: 200, headers: { get: () => "c" }, text: async () => JSON.stringify(body) };
  };
  return new JkPlatformClient({ baseUrl: "http://api.test", tenantId: "t", auth: { mode: "none" }, fetch });
}

function wrap(route: string) {
  const c = client();
  return render(
    <MemoryRouter initialEntries={[route]}>
      <I18nProvider initialLocale="pt-BR">
        <SessionProvider initialSession={session} clientFactory={() => c}>
          <LotDetail />
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("LotDetail financials", () => {
  it("shows lot revenue/cost/margin formatted in the returned currency (USD)", async () => {
    wrap("/lots/lot-1");
    await waitFor(() => expect(screen.getByText("Financeiro (lote)")).toBeInTheDocument());
    // pt-BR grouping + USD symbol: "US$ 8.200,00" etc.
    expect(screen.getByText(/US\$\s?8\.200,00/)).toBeInTheDocument();
    expect(screen.getByText(/US\$\s?5\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/US\$\s?3\.200,00/)).toBeInTheDocument();
  });
});
