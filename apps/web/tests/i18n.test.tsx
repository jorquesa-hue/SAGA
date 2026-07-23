import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { I18nProvider } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "11111111-2222-3333-4444-555555555555", platformAdmin: false };

function client(): JkPlatformClient {
  const fetch: FetchLike = async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = path.startsWith("/api/v1/dashboards/executive") ? { herd: { active: 7 } } : { items: [] };
    return { status: 200, headers: { get: () => "c" }, text: async () => JSON.stringify(body) };
  };
  return new JkPlatformClient({ baseUrl: "http://api.test", tenantId: "t", auth: { mode: "none" }, fetch });
}

function renderApp(initialLocale: "pt-BR" | "en") {
  const c = client();
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <I18nProvider initialLocale={initialLocale}>
        <SessionProvider initialSession={session} clientFactory={() => c}>
          <App />
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("i18n", () => {
  it("renders pt-BR by default and switches the whole shell to English", async () => {
    renderApp("pt-BR");
    await waitFor(() => expect(screen.getByText("Painel executivo")).toBeInTheDocument());
    // Nav is translated too.
    expect(screen.getByText("Animais")).toBeInTheDocument();

    // Toggle to English.
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(screen.getByText("Executive dashboard")).toBeInTheDocument());
    expect(screen.getByText("Animals")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
    expect(screen.queryByText("Painel executivo")).not.toBeInTheDocument();
  });

  it("starts in English when that locale is active", async () => {
    renderApp("en");
    await waitFor(() => expect(screen.getByText("Executive dashboard")).toBeInTheDocument());
    expect(screen.getByText("Import")).toBeInTheDocument();
  });
});
