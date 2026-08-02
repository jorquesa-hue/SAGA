import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Treatments } from "../src/pages/Treatments.js";
import { Finance } from "../src/pages/Finance.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function capturingClient(): {
  client: JkPlatformClient;
  posts: { path: string; body: unknown }[];
} {
  const posts: { path: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    if ((init?.method ?? "GET") === "POST")
      posts.push({ path, body: JSON.parse((init?.body as string) ?? "{}") });
    return {
      status: 201,
      headers: { get: () => "c" },
      text: async () => JSON.stringify({ id: "x1" }),
    };
  };
  return {
    client: new JkPlatformClient({
      baseUrl: "http://api.test",
      tenantId: "t",
      auth: { mode: "none" },
      fetch,
    }),
    posts,
  };
}

function renderWith(node: JSX.Element, c: JkPlatformClient) {
  return render(
    <MemoryRouter>
      <SessionProvider initialSession={session} clientFactory={() => c}>
        {node}
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("Treatments command", () => {
  it("posts a treatment with a withdrawal restriction hint", async () => {
    const { client, posts } = capturingClient();
    renderWith(<Treatments />, client);
    fireEvent.change(screen.getByPlaceholderText("animal uuid"), {
      target: { value: "a-1" },
    });
    fireEvent.change(screen.getByPlaceholderText("ex.: Ivermectina"), {
      target: { value: "Ivermectina" },
    });
    fireEvent.click(screen.getByText("Registrar"));
    await waitFor(() =>
      expect(screen.getByText(/Tratamento registrado/)).toBeInTheDocument(),
    );
    expect(posts[0]!.path).toBe("/api/v1/animals/a-1/treatments");
    expect((posts[0]!.body as { productName: string }).productName).toBe("Ivermectina");
  });
});

describe("Finance command", () => {
  it("routes an expense vs a sale to the correct endpoints", async () => {
    const { client, posts } = capturingClient();
    renderWith(<Finance />, client);
    fireEvent.change(screen.getByPlaceholderText("ex.: nutrição"), {
      target: { value: "nutrição" },
    });
    fireEvent.change(screen.getByLabelText("Valor (ex.: 1250.00)"), {
      target: { value: "1250.00" },
    });
    fireEvent.click(screen.getByText("Registrar"));
    await waitFor(() =>
      expect(posts.some((p) => p.path === "/api/v1/finance/expenses")).toBe(true),
    );
  });
});

// Silence jsdom's unimplemented alert used by some pages.
vi.stubGlobal("alert", () => {});
