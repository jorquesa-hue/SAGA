import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SearchResults } from "../src/pages/SearchResults.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function client(result: unknown): JkPlatformClient {
  const fetch: FetchLike = async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = path.startsWith("/api/v1/search") ? result : {};
    return { status: 200, headers: { get: () => "c" }, text: async () => JSON.stringify(body) };
  };
  return new JkPlatformClient({ baseUrl: "http://api.test", tenantId: "t", auth: { mode: "none" }, fetch });
}

describe("SearchResults page", () => {
  it("renders grouped results with an animal link", async () => {
    const c = client({
      query: "BR",
      animals: [{ type: "animal", id: "a-1", label: "BR-0001", sublabel: "RFID 982" }],
      lots: [{ type: "lot", id: "l-1", label: "Lote 1", sublabel: "open" }],
      paddocks: [],
      people: [],
    });
    render(
      <MemoryRouter initialEntries={["/search?q=BR"]}>
        <SessionProvider initialSession={session} clientFactory={() => c}>
          <SearchResults />
        </SessionProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("BR-0001")).toBeInTheDocument());
    expect(screen.getByText("Lote 1")).toBeInTheDocument();
    expect(screen.getByText("BR-0001").closest("a")?.getAttribute("href")).toBe("/animals/a-1");
  });

  it("shows an empty state when nothing matches", async () => {
    const c = client({ query: "zzz", animals: [], lots: [], paddocks: [], people: [] });
    render(
      <MemoryRouter initialEntries={["/search?q=zzz"]}>
        <SessionProvider initialSession={session} clientFactory={() => c}>
          <SearchResults />
        </SessionProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Nenhum resultado.")).toBeInTheDocument());
  });
});
