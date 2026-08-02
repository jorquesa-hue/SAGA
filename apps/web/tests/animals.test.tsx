import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Animals } from "../src/pages/Animals.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function client(handlers: {
  get: (p: string) => unknown;
  post: (p: string, body?: unknown) => unknown;
}): JkPlatformClient {
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    const parsedBody =
      typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const body =
      (init?.method ?? "GET") === "GET" ? handlers.get(path) : handlers.post(path, parsedBody);
    return {
      status: 200,
      headers: { get: () => "corr" },
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
          return {
            items: [
              {
                id: "a-1",
                visualId: "BR-001",
                sex: "female",
                breedCode: "BRANGUS",
                lifecycleStatus: "active",
              },
            ],
          };
        }
        return {};
      },
      post: (path) => {
        if (path === "/api/v1/exports")
          return {
            id: "exp-1",
            exportType: "animal_traceability_packet",
            format: "json",
            status: "pending",
            resolvableUrl: "/api/v1/exports/exp-1/download",
          };
        if (path === "/api/v1/exports/exp-1/process")
          return {
            id: "exp-1",
            exportType: "animal_traceability_packet",
            format: "json",
            status: "completed",
            resolvableUrl: "/api/v1/exports/exp-1/download",
          };
        return {};
      },
    });
    renderAnimals(c);

    await waitFor(() => expect(screen.getByText("BR-001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Exportar"));
    await waitFor(() =>
      expect(
        screen.getByText(/Pronto — \/api\/v1\/exports\/exp-1\/download/),
      ).toBeInTheDocument(),
    );
  });

  it("shows a friendly empty state", async () => {
    const c = client({ get: () => ({ items: [] }), post: () => ({}) });
    renderAnimals(c);
    await waitFor(() =>
      expect(screen.getByText("Nenhum animal encontrado.")).toBeInTheDocument(),
    );
  });

  it("filters the list by visual ID (client-side search)", async () => {
    const c = client({
      get: (path) =>
        path === "/api/v1/animals"
          ? {
              items: [
                {
                  id: "a-1",
                  visualId: "BR-0001",
                  sex: "female",
                  breedCode: "BRANGUS",
                  lifecycleStatus: "active",
                },
                {
                  id: "a-2",
                  visualId: "BR-0099",
                  sex: "male",
                  breedCode: "BRANGUS",
                  lifecycleStatus: "active",
                },
              ],
            }
          : {},
      post: () => ({}),
    });
    renderAnimals(c);
    await waitFor(() => expect(screen.getByText("BR-0001")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Buscar por ID visual…"), {
      target: { value: "0099" },
    });
    await waitFor(() => expect(screen.queryByText("BR-0001")).not.toBeInTheDocument());
    expect(screen.getByText("BR-0099")).toBeInTheDocument();
  });

  it("shows the species column and registers a non-bovine animal (multi-species support)", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    const c = client({
      get: (path) =>
        path === "/api/v1/animals"
          ? {
              items: [
                {
                  id: "a-1",
                  visualId: "OV-001",
                  speciesCode: "OVINE",
                  sex: "female",
                  breedCode: "SANTA_INES",
                  lifecycleStatus: "active",
                },
              ],
            }
          : {},
      post: (path, body) => {
        posts.push({ path, body });
        return { id: "a-2", visualId: "OV-002", speciesCode: "OVINE", lifecycleStatus: "active" };
      },
    });
    renderAnimals(c);

    await waitFor(() => expect(screen.getByText("OV-001")).toBeInTheDocument());
    expect(screen.getByText("Ovino")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Registrar animal"));
    fireEvent.change(screen.getByLabelText("Espécie"), { target: { value: "OVINE" } });
    fireEvent.change(screen.getByLabelText("Fazenda ID"), { target: { value: "farm-1" } });
    fireEvent.change(screen.getByLabelText("ID visual"), { target: { value: "OV-002" } });
    fireEvent.click(screen.getByText("Registrar"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/api/v1/animals");
    expect((posts[0]!.body as { speciesCode: string }).speciesCode).toBe("OVINE");
    // Picking a species suggests one of its breeds instead of leaving the
    // BOVINE default (BRANGUS) on a sheep.
    expect((posts[0]!.body as { breedCode: string }).breedCode).not.toBe("BRANGUS");
  });
});
