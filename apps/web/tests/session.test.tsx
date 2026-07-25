import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { SessionProvider, type Session } from "../src/session.js";

function fakeClient(script: (path: string) => unknown): JkPlatformClient {
  const fetch: FetchLike = async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = script(path);
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

const session: Session = {
  userId: "u1",
  tenantId: "11111111-2222-3333-4444-555555555555",
  platformAdmin: false,
};

function renderApp(initialSession: Session | null, route = "/") {
  const client = fakeClient((path) => {
    if (path.startsWith("/api/v1/dashboards/executive"))
      return { herd: { activeAnimals: 42 } };
    if (path.startsWith("/api/v1/animals")) return { items: [] };
    if (path.startsWith("/api/v1/recommendations")) return { items: [] };
    return {};
  });
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider initialSession={initialSession} clientFactory={() => client}>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("web console session", () => {
  it("shows the sign-in screen when there is no session", () => {
    renderApp(null);
    expect(
      screen.getByText("Console de gestão — sessão de desenvolvimento"),
    ).toBeInTheDocument();
  });

  it("renders the dashboard KPIs once signed in", async () => {
    renderApp(session);
    await waitFor(() => expect(screen.getByText("Painel executivo")).toBeInTheDocument());
    // The tile is labelled for a reader, not with the API's key path. This
    // metric is not in the catalogue, so it takes the humanised fallback.
    await waitFor(() =>
      expect(screen.getByText("Herd · active animals")).toBeInTheDocument(),
    );
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("signs out back to the sign-in screen", async () => {
    renderApp(session);
    await waitFor(() => expect(screen.getByText("Sair")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Sair"));
    await waitFor(() =>
      expect(
        screen.getByText("Console de gestão — sessão de desenvolvimento"),
      ).toBeInTheDocument(),
    );
  });
});
