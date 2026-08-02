import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Finance } from "../src/pages/Finance.js";
import { TenantSettingsLoader } from "../src/components/TenantSettingsLoader.js";
import { I18nProvider } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

interface Post {
  path: string;
  body: Record<string, unknown>;
}

/** Client whose GET /tenants/current returns configured base settings; captures POSTs. */
function client(
  defaultCurrency: string,
  defaultLocale: string,
  posts: Post[],
): JkPlatformClient {
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    if (path === "/api/v1/tenants/current") {
      return {
        status: 200,
        headers: { get: () => "c" },
        text: async () =>
          JSON.stringify({ id: "t-1", name: "Rancho", defaultCurrency, defaultLocale }),
      };
    }
    if ((init?.method ?? "GET") === "POST") {
      posts.push({
        path,
        body: JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>,
      });
      return {
        status: 201,
        headers: { get: () => "c" },
        text: async () => JSON.stringify({ id: "x1" }),
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

function renderWithTenant(defaultCurrency: string, defaultLocale: string) {
  const posts: Post[] = [];
  const c = client(defaultCurrency, defaultLocale, posts);
  const utils = render(
    <MemoryRouter>
      <I18nProvider>
        <SessionProvider initialSession={session} clientFactory={() => c}>
          <TenantSettingsLoader />
          <Finance />
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  return { ...utils, posts };
}

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("per-tenant currency", () => {
  it("adopts the tenant's currency and locale (USD / English) and records in USD", async () => {
    const { posts } = renderWithTenant("USD", "en");
    // Loader is async: wait until the tenant locale ("en") has been adopted.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Finance" })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Amount (e.g. 1250.00)"), {
      target: { value: "1250" },
    });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "feed" } });
    fireEvent.click(screen.getAllByText("Record")[0]!);

    await waitFor(() => expect(screen.getByText(/Entry recorded/)).toBeInTheDocument());
    const msg = screen.getByText(/Entry recorded/).textContent ?? "";
    // en-US + USD → "$1,250.00"
    expect(msg).toContain("$1,250.00");
    expect(msg).not.toContain("R$");

    // The write carries the tenant currency, not a server-side default.
    const expense = posts.find((p) => p.path === "/api/v1/finance/expenses");
    expect(expense?.body.currency).toBe("USD");
    expect(expense?.body.amount).toBe("1250");
  });

  it("keeps BRL when the tenant has no configured currency", async () => {
    renderWithTenant("", "pt-BR"); // empty currency → loader leaves the BRL default
    fireEvent.change(screen.getByLabelText("Valor (ex.: 1250.00)"), {
      target: { value: "1250" },
    });
    fireEvent.change(screen.getByLabelText("Categoria"), {
      target: { value: "nutrição" },
    });
    fireEvent.click(screen.getAllByText("Registrar")[0]!);
    await waitFor(() =>
      expect(screen.getByText(/Lançamento registrado/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Lançamento registrado/).textContent ?? "").toContain("R$");
  });
});
