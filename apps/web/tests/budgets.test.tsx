import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Budgets } from "../src/pages/Budgets.js";
import { I18nProvider } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

interface Req {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function client(reqs: Req[]): JkPlatformClient {
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const bare = path.replace(/\?.*$/, "");
    reqs.push({
      method,
      path,
      ...(init?.body
        ? { body: JSON.parse(init.body as string) as Record<string, unknown> }
        : {}),
    });
    if (bare === "/api/v1/finance/budget-variance") {
      return {
        status: 200,
        headers: { get: () => "c" },
        text: async () =>
          JSON.stringify({
            planned: "1250.00",
            actual: "900.00",
            variance: "350.00",
            currency: "USD",
          }),
      };
    }
    return { status: 204, headers: { get: () => "c" }, text: async () => "" };
  };
  return new JkPlatformClient({
    baseUrl: "http://api.test",
    tenantId: "t",
    auth: { mode: "none" },
    fetch,
  });
}

function renderBudgets(reqs: Req[]) {
  const c = client(reqs);
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale="pt-BR">
        <SessionProvider initialSession={session} clientFactory={() => c}>
          <Budgets />
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Budgets page", () => {
  it("sets a budget (with tenant currency) and shows variance formatted in the returned currency", async () => {
    const reqs: Req[] = [];
    renderBudgets(reqs);

    // Set a budget (the first period/category fields belong to the set form).
    fireEvent.change(screen.getAllByLabelText("Período (AAAA-MM)")[0]!, {
      target: { value: "2026-07" },
    });
    fireEvent.change(screen.getAllByLabelText("Categoria")[0]!, {
      target: { value: "nutrição" },
    });
    fireEvent.change(screen.getByLabelText("Valor planejado"), {
      target: { value: "1250.00" },
    });
    fireEvent.click(screen.getByText("Salvar orçamento"));

    await waitFor(() => expect(screen.getByText("Orçamento salvo")).toBeInTheDocument());
    const post = reqs.find(
      (r) => r.method === "POST" && r.path === "/api/v1/finance/budgets",
    );
    expect(post?.body).toMatchObject({
      periodMonth: "2026-07",
      category: "nutrição",
      planned: "1250.00",
      currency: "BRL",
    });

    // Query variance (second period/category fields are the variance form).
    const periodFields = screen.getAllByLabelText("Período (AAAA-MM)");
    const categoryFields = screen.getAllByLabelText("Categoria");
    fireEvent.change(periodFields[1]!, { target: { value: "2026-07" } });
    fireEvent.change(categoryFields[1]!, { target: { value: "nutrição" } });
    fireEvent.click(screen.getByText("Consultar"));

    // planned/actual/variance in the returned currency (USD), pt-BR grouping.
    await waitFor(() => expect(screen.getByText(/US\$\s?1\.250,00/)).toBeInTheDocument());
    expect(screen.getByText(/US\$\s?900,00/)).toBeInTheDocument();
    expect(screen.getByText(/US\$\s?350,00/)).toBeInTheDocument();
    expect(
      reqs.some(
        (r) => r.method === "GET" && r.path.startsWith("/api/v1/finance/budget-variance"),
      ),
    ).toBe(true);
  });
});
