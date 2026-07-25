import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TraceabilityRecord } from "../src/pages/TraceabilityRecord.js";
import { I18nProvider } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function renderRecord() {
  const fetch: FetchLike = async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = path.includes("/weights")
      ? { items: [{ occurredAt: "2026-02-01T00:00:00.000Z", weightKg: 214 }] }
      : path.includes("/treatments")
        ? {
            items: [
              { administeredAt: "2026-01-05T00:00:00.000Z", productName: "Ivermectina" },
            ],
          }
        : path.includes("/restrictions")
          ? { items: [] }
          : { id: "a-1", visualId: "BR-0001", sex: "female", lifecycleStatus: "active" };
    return {
      status: 200,
      headers: { get: () => "c" },
      text: async () => JSON.stringify(body),
    };
  };
  const client = new JkPlatformClient({
    baseUrl: "http://api.test",
    tenantId: "t",
    auth: { mode: "none" },
    fetch,
  });
  return render(
    <MemoryRouter initialEntries={["/animals/a-1/record"]}>
      <I18nProvider initialLocale="pt-BR">
        <SessionProvider initialSession={session} clientFactory={() => client}>
          <Routes>
            <Route path="/animals/:id/record" element={<TraceabilityRecord />} />
          </Routes>
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

/**
 * docs/brand §4.2 — the record is the artefact a buyer or auditor carries
 * away. It must read as a record: the mark, identifiers in the mono face, the
 * history in order, and a plain statement of why it can be trusted.
 */
describe("traceability record", () => {
  it("carries the mark and the animal's identifiers", async () => {
    renderRecord();
    expect(await screen.findByText("Registro de rastreabilidade")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "SAGA" })).toBeInTheDocument();
    expect(await screen.findByText("BR-0001")).toBeInTheDocument();
  });

  it("sets identifiers in the mono face, not display type", async () => {
    const { container } = renderRecord();
    await screen.findByText("BR-0001");
    expect(screen.getByText("BR-0001")).toHaveClass("mono");
    expect(container.querySelector(".record-chain .mono")).not.toBeNull();
  });

  it("lists the history in the order it happened", async () => {
    const { container } = renderRecord();
    await screen.findByText(/Ivermectina/);
    const rows = [...container.querySelectorAll(".record-chain li")].map(
      (li) => li.textContent ?? "",
    );
    expect(rows).toHaveLength(2);
    // The treatment (January) precedes the weighing (February).
    expect(rows[0]).toMatch(/Ivermectina/);
    expect(rows[1]).toMatch(/214/);
  });

  it("states plainly that the extract is append-only", async () => {
    renderRecord();
    expect(await screen.findByText(/append-only/i)).toBeInTheDocument();
  });
});
