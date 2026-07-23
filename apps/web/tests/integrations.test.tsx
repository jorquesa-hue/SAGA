import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Integrations } from "../src/pages/Integrations.js";
import { Exports } from "../src/pages/Exports.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function client(routes: Record<string, unknown>, onPost?: (path: string) => unknown): JkPlatformClient {
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    const method = init?.method ?? "GET";
    const body = method === "GET" ? routes[path] ?? {} : onPost?.(path) ?? {};
    return { status: method === "DELETE" ? 204 : 200, headers: { get: () => "c" }, text: async () => JSON.stringify(body) };
  };
  return new JkPlatformClient({ baseUrl: "http://api.test", tenantId: "t", auth: { mode: "none" }, fetch });
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

describe("Integrations page", () => {
  it("subscribes and reveals the one-time secret", async () => {
    const c = client(
      {
        "/api/v1/webhooks/subscriptions": { items: [] },
        "/api/v1/webhooks/deliveries": { items: [] },
        "/api/v1/connectors": { items: [] },
      },
      (path) =>
        path === "/api/v1/webhooks/subscriptions"
          ? { id: "s1", url: "https://x", eventFamilies: ["animal"], active: true, secret: "whsec_shown_once" }
          : {},
    );
    renderWith(<Integrations />, c);
    await waitFor(() => expect(screen.getByText("Assinaturas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Assinar"));
    await waitFor(() => expect(screen.getByText("whsec_shown_once")).toBeInTheDocument());
  });
});

describe("Exports page", () => {
  it("lists export jobs and their download links", async () => {
    const c = client({
      "/api/v1/exports": {
        items: [{ id: "e1", exportType: "animal_inventory", format: "json", status: "completed", byteSize: 12, resolvableUrl: "/api/v1/exports/e1/download" }],
      },
    });
    renderWith(<Exports />, c);
    await waitFor(() => expect(screen.getByText("/api/v1/exports/e1/download")).toBeInTheDocument());
  });
});
