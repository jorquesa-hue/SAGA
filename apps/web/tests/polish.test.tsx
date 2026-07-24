import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Animals } from "../src/pages/Animals.js";
import { LotDetail } from "../src/pages/LotDetail.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function client(routes: (path: string) => unknown): JkPlatformClient {
  const fetch: FetchLike = async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    return { status: 200, headers: { get: () => "c" }, text: async () => JSON.stringify(routes(path)) };
  };
  return new JkPlatformClient({ baseUrl: "http://api.test", tenantId: "t", auth: { mode: "none" }, fetch });
}

function wrap(node: JSX.Element, c: JkPlatformClient, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider initialSession={session} clientFactory={() => c}>
        {node}
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("Animals pagination", () => {
  it("pages a long animal list (20/page) and advances", async () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      id: `a-${i}`,
      visualId: `BR-${String(i).padStart(4, "0")}`,
      sex: "female",
      breedCode: "BRANGUS",
      lifecycleStatus: "active",
    }));
    wrap(<Animals />, client((path) => (path === "/api/v1/animals" ? { items } : {})));

    await waitFor(() => expect(screen.getByText("BR-0000")).toBeInTheDocument());
    // Page 1 shows the first 20; item 20 (BR-0020) is on page 2.
    expect(screen.queryByText("BR-0020")).not.toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 3 · 45 itens/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Próxima/));
    await waitFor(() => expect(screen.getByText("BR-0020")).toBeInTheDocument());
    expect(screen.queryByText("BR-0000")).not.toBeInTheDocument();
  });
});

describe("LotDetail", () => {
  it("shows current paddock and paginated members with animal links", async () => {
    const members = Array.from({ length: 30 }, (_, i) => ({ animalId: `an-${i}`, status: "active" }));
    const c = client((path) => {
      if (path.endsWith("/current-paddock")) return { paddockName: "Piquete 7" };
      if (path.endsWith("/members")) return { items: members };
      return {};
    });
    wrap(<LotDetail />, c, "/lots/lot-1");

    await waitFor(() => expect(screen.getByText("Piquete 7")).toBeInTheDocument());
    expect(screen.getByText("Membros ativos")).toBeInTheDocument();
    // 30 members, 25/page → page 1 of 2.
    expect(screen.getByText(/Página 1 de 2 · 30 itens/)).toBeInTheDocument();
    expect(screen.getByText("an-0…").closest("a")?.getAttribute("href")).toBe("/animals/an-0");
  });
});
