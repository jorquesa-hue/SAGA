import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Settings } from "../src/pages/Settings.js";
import { I18nProvider } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

interface Patch {
  path: string;
  method: string;
  body: Record<string, unknown>;
}

function client(
  patches: Patch[],
  current = { defaultCurrency: "BRL", defaultLocale: "pt-BR" },
): JkPlatformClient {
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    const method = init?.method ?? "GET";
    if (path === "/api/v1/tenants/current" && method === "GET") {
      return {
        status: 200,
        headers: { get: () => "c" },
        text: async () => JSON.stringify({ id: "t-1", name: "Rancho JK", ...current }),
      };
    }
    if (path === "/api/v1/tenants/current" && method === "PATCH") {
      const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
      patches.push({ path, method, body });
      return {
        status: 200,
        headers: { get: () => "c" },
        text: async () => JSON.stringify({ id: "t-1", name: "Rancho JK", ...body }),
      };
    }
    return {
      status: 200,
      headers: { get: () => "c" },
      text: async () => JSON.stringify({ items: [] }),
    };
  };
  return new JkPlatformClient({
    baseUrl: "http://api.test",
    tenantId: "t",
    auth: { mode: "none" },
    fetch,
  });
}

function renderSettings(patches: Patch[]) {
  const c = client(patches);
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale="pt-BR">
        <SessionProvider initialSession={session} clientFactory={() => c}>
          <Settings />
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("Settings page", () => {
  it("loads the tenant and PATCHes new currency + locale, then re-applies live", async () => {
    const patches: Patch[] = [];
    renderSettings(patches);

    // Tenant name loads.
    await waitFor(() => expect(screen.getByText("Rancho JK")).toBeInTheDocument());

    // Change currency to USD and language to English.
    fireEvent.change(screen.getByLabelText("Moeda"), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("Idioma"), { target: { value: "en" } });
    fireEvent.click(screen.getByText("Salvar"));

    // The write carries both fields.
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.method).toBe("PATCH");
    expect(patches[0]!.body).toMatchObject({
      defaultCurrency: "USD",
      defaultLocale: "en",
    });

    // The console re-applies the new locale live (title now in English).
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument(),
    );
    // The success toast was composed at save time (pt-BR), before the switch.
    expect(screen.getByText("Configurações salvas")).toBeInTheDocument();
  });
});
