import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimalDetail } from "../src/pages/AnimalDetail.js";
import { I18nProvider } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

interface Photo {
  id: string;
  animalId: string;
  takenAt: string;
  caption?: string | null;
  status: string;
}

/** Route AnimalDetail's calls to a scripted, in-memory photo gallery. */
function renderDetail(photos: Photo[]) {
  const uploads: FormData[] = [];
  const removed: string[] = [];

  const fetch: FetchLike = async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    const method = init?.method ?? "GET";

    if (path === "/api/v1/animals/a-1/photos" && method === "GET") {
      return {
        status: 200,
        headers: { get: () => "c" },
        text: async () =>
          JSON.stringify({ items: photos.filter((p) => p.status === "active") }),
      };
    }
    if (path === "/api/v1/animals/a-1/photos" && method === "POST") {
      const form = init?.body as FormData;
      uploads.push(form);
      const created: Photo = {
        id: `photo-${photos.length + 1}`,
        animalId: "a-1",
        takenAt: String(form.get("takenAt")),
        caption: form.get("caption") ? String(form.get("caption")) : null,
        status: "active",
      };
      photos.push(created);
      return {
        status: 201,
        headers: { get: () => "c" },
        text: async () => JSON.stringify(created),
      };
    }
    if (path.match(/\/photos\/photo-\d+\/download$/) && method === "GET") {
      return {
        status: 200,
        headers: { get: (name: string) => (name === "content-type" ? "image/jpeg" : "c") },
        text: async () => "",
        blob: async () => new Blob(["bytes"], { type: "image/jpeg" }),
      };
    }
    if (path.match(/\/photos\/photo-\d+$/) && method === "DELETE") {
      const id = path.split("/").pop()!;
      removed.push(id);
      const found = photos.find((p) => p.id === id);
      if (found) found.status = "removed";
      return { status: 204, headers: { get: () => "c" }, text: async () => "" };
    }
    if (path === "/api/v1/animals/a-1" && method === "GET") {
      return {
        status: 200,
        headers: { get: () => "c" },
        text: async () =>
          JSON.stringify({ id: "a-1", visualId: "BR-0001", sex: "female" }),
      };
    }
    if (
      (path.endsWith("/weights") ||
        path.endsWith("/restrictions") ||
        path.endsWith("/treatments")) &&
      method === "GET"
    ) {
      return { status: 200, headers: { get: () => "c" }, text: async () => JSON.stringify({ items: [] }) };
    }
    // reproduction-status and anything else: an empty object is a valid response shape.
    return { status: 200, headers: { get: () => "c" }, text: async () => JSON.stringify({}) };
  };

  const client = new JkPlatformClient({
    baseUrl: "http://api.test",
    tenantId: "t",
    auth: { mode: "none" },
    fetch,
  });

  render(
    <MemoryRouter initialEntries={["/animals/a-1"]}>
      <I18nProvider initialLocale="pt-BR">
        <SessionProvider initialSession={session} clientFactory={() => client}>
          <Routes>
            <Route path="/animals/:id" element={<AnimalDetail />} />
          </Routes>
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );

  return { uploads, removed };
}

describe("Animal photo gallery (dated album, not a single profile photo)", () => {
  // jsdom has no real object-URL implementation; stub it so PhotoThumb can render.
  const createObjectURL = vi.fn(() => "blob:mock");
  const revokeObjectURL = vi.fn();
  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });
  afterEach(() => vi.clearAllMocks());

  it("shows an empty state, then uploads a dated photo that appears in the gallery", async () => {
    const { uploads } = renderDetail([]);
    await waitFor(() => expect(screen.getByText("Nenhuma foto ainda.")).toBeInTheDocument());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["lamb"], "lamb.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Data da foto"), {
      target: { value: "2026-01-15" },
    });
    fireEvent.change(screen.getByLabelText("Legenda (opcional)"), {
      target: { value: "Primeiras semanas" },
    });
    fireEvent.click(screen.getByText("Enviar"));

    await waitFor(() => expect(screen.getByText("Foto adicionada")).toBeInTheDocument());
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.get("takenAt")).toBe("2026-01-15");
    await waitFor(() => expect(screen.getAllByText("Remover")).toHaveLength(1));
  });

  it("renders two dated photos and soft-removes one via the API, not a hard delete", async () => {
    const { removed } = renderDetail([
      { id: "photo-1", animalId: "a-1", takenAt: "2025-01-10", status: "active" },
      { id: "photo-2", animalId: "a-1", takenAt: "2026-01-10", status: "active" },
    ]);

    await waitFor(() => expect(screen.getAllByText("Remover")).toHaveLength(2));

    fireEvent.click(screen.getAllByText("Remover")[0]!);

    await waitFor(() => expect(screen.getAllByText("Remover")).toHaveLength(1));
    expect(removed).toHaveLength(1);
  });
});
