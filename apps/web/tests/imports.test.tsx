import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Imports } from "../src/pages/Imports.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

/** Drives the staged import endpoints through a scripted job state machine. */
function importClient(): JkPlatformClient {
  const job = (status: string, over: Record<string, unknown> = {}) => ({
    id: "imp-1",
    importType: "animals",
    status,
    filename: "a.csv",
    totalRows: 2,
    validRows: 1,
    invalidRows: 0,
    duplicateRows: 1,
    executedRows: 0,
    failedRows: 0,
    ...over,
  });
  const preview = (j: unknown) => ({
    job: j,
    sample: [
      {
        rowNumber: 1,
        raw: {},
        mapped: { visualId: "BR-9001", sex: "female", breedCode: "BRANGUS" },
        validationStatus: "valid",
        errors: [],
        executionStatus: "pending",
        serverId: null,
        executionError: null,
      },
    ],
    invalidSample: [
      {
        rowNumber: 2,
        raw: {},
        mapped: {},
        validationStatus: "duplicate",
        errors: [{ field: "visualId", reason: "already exists" }],
        executionStatus: "pending",
        serverId: null,
        executionError: null,
      },
    ],
  });
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    const method = init?.method ?? "GET";
    let body: unknown = {};
    if (path === "/api/v1/imports" && method === "POST") body = job("uploaded");
    else if (path.endsWith("/parse")) body = job("parsed");
    else if (path.endsWith("/map")) body = job("mapped");
    else if (path.endsWith("/validate")) body = job("validated");
    else if (path.endsWith("/preview")) body = preview(job("validated"));
    else if (path.endsWith("/execute")) body = job("executed", { executedRows: 1 });
    else if (path.endsWith("/reconcile"))
      body = preview(job("reconciled", { executedRows: 1, status: "reconciled" }));
    return {
      status: 200,
      headers: { get: () => "c" },
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

function renderImports(c: JkPlatformClient) {
  return render(
    <MemoryRouter>
      <SessionProvider initialSession={session} clientFactory={() => c}>
        <Imports />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("Imports wizard", () => {
  it("walks upload → map → preview → execute → done", async () => {
    renderImports(importClient());

    // Upload step.
    fireEvent.change(screen.getByPlaceholderText(/tag,gender/), {
      target: { value: "tag,sex\nBR-9001,female\nBR-0001,male" },
    });
    fireEvent.change(screen.getByPlaceholderText("farm uuid"), {
      target: { value: "farm-1" },
    });
    fireEvent.click(screen.getByText("Enviar e analisar"));

    // Map step (headers detected from the pasted CSV).
    await waitFor(() => expect(screen.getByText(/Mapear colunas/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Validar"));

    // Preview step shows counts and the invalid reason.
    await waitFor(() => expect(screen.getByText("válidas 1")).toBeInTheDocument());
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Executar importação/));

    // Done step shows the reconciliation.
    await waitFor(() => expect(screen.getByText("criadas 1")).toBeInTheDocument());
    expect(screen.getByText("Registros criados")).toBeInTheDocument();
  });
});
