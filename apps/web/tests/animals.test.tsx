import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Animals } from "../src/pages/Animals.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function client(handlers: { get: (p: string) => unknown; post: (p: string) => unknown }): JkPlatformClient {
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    const body = (init?.method ?? "GET") === "GET" ? handlers.get(path) : handlers.post(path);
    return { status: 200, headers: { get: () => "corr" }, text: async () => JSON.stringify(body) };
  };
  return new JkPlatformClient({ baseUrl: "http://api.test", tenantId: "t", auth: { mode: "none" }, fetch });
}

function renderAnimals(c: JkPlatformClient) {
  return render(
    <MemoryRouter>
      <SessionProvider initialSession={session} clientFactory={() => c}>
        <Animals />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("Animals page", () => {
  it("lists animals and exports a traceability packet (JK-ANI-006)", async () => {
    const c = client({
      get: (path) => {
        if (path === "/api/v1/animals") {
          return { items: [{ id: "a-1", visualId: "BR-001", sex: "female", breedCode: "BRANGUS", lifecycleStatus: "active" }] };
        }
        return {};
      },
      post: (path) => {
        if (path === "/api/v1/exports") return { id: "exp-1", exportType: "animal_traceability_packet", format: "json", status: "pending", resolvableUrl: "/api/v1/exports/exp-1/download" };
        if (path === "/api/v1/exports/exp-1/process") return { id: "exp-1", exportType: "animal_traceability_packet", format: "json", status: "completed", resolvableUrl: "/api/v1/exports/exp-1/download" };
        return {};
      },
    });
    renderAnimals(c);

    await waitFor(() => expect(screen.getByText("BR-001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Exportar"));
    await waitFor(() =>
      expect(screen.getByText(/Pronto — \/api\/v1\/exports\/exp-1\/download/)).toBeInTheDocument(),
    );
  });

  it("shows a friendly empty state", async () => {
    const c = client({ get: () => ({ items: [] }), post: () => ({}) });
    renderAnimals(c);
    await waitFor(() => expect(screen.getByText("Nenhum animal registrado.")).toBeInTheDocument());
  });
});
