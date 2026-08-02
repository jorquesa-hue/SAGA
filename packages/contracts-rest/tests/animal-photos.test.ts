import { describe, expect, it } from "vitest";
import { JkPlatformClient, type FetchLike } from "../src/index.js";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | FormData;
}

function fakeFetch(
  script: (req: Captured) => {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
    blob?: Blob;
  },
): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetch: FetchLike = async (url, init) => {
    const captured: Captured = {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(captured);
    const res = script(captured);
    const headers = { "x-correlation-id": "srv-corr", ...(res.headers ?? {}) };
    return {
      status: res.status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => (res.body === undefined ? "" : JSON.stringify(res.body)),
      blob: res.blob ? async () => res.blob! : undefined,
    };
  };
  return { fetch, calls };
}

const idSeq = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("JkPlatformClient.animals.photos", () => {
  it("uploads a photo as multipart form data without a JSON content-type", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 201,
      body: { id: "photo-1", animalId: "animal-1", takenAt: "2026-01-15" },
    }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      auth: { mode: "dev", devUserId: "user-1" },
      tenantId: "tenant-1",
      fetch,
      newId: idSeq(),
    });

    const file = new Blob(["fake-bytes"], { type: "image/jpeg" });
    const photo = await client.animals.photos.upload("animal-1", {
      file,
      filename: "lamb.jpg",
      takenAt: "2026-01-15",
      caption: "First weeks",
    });

    expect(photo.id).toBe("photo-1");
    const req = calls[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.test/api/v1/animals/animal-1/photos");
    expect(req.headers["idempotency-key"]).toBeDefined();
    // Fetch sets the multipart boundary itself; the client must not override it.
    expect(req.headers["content-type"]).toBeUndefined();
    expect(req.body).toBeInstanceOf(FormData);
    const form = req.body as FormData;
    expect(form.get("takenAt")).toBe("2026-01-15");
    expect(form.get("caption")).toBe("First weeks");
    expect((form.get("file") as File).name).toBe("lamb.jpg");
  });

  it("lists the gallery with a plain GET", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 200,
      body: { items: [{ id: "photo-1" }] },
    }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      auth: { mode: "dev", devUserId: "user-1" },
      tenantId: "tenant-1",
      fetch,
      newId: idSeq(),
    });

    const result = await client.animals.photos.list("animal-1");
    expect(result.items).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["idempotency-key"]).toBeUndefined();
  });

  it("downloads a photo's bytes as a Blob", async () => {
    const bytes = new Blob(["photo-bytes"], { type: "image/png" });
    const { fetch, calls } = fakeFetch(() => ({
      status: 200,
      blob: bytes,
      headers: { "content-type": "image/png" },
    }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      auth: { mode: "dev", devUserId: "user-1" },
      tenantId: "tenant-1",
      fetch,
      newId: idSeq(),
    });

    const result = await client.animals.photos.download("animal-1", "photo-1");
    expect(result.contentType).toBe("image/png");
    expect(result.blob).toBe(bytes);
    expect(calls[0]!.url).toBe(
      "https://api.test/api/v1/animals/animal-1/photos/photo-1/download",
    );
  });

  it("soft-removes a photo with an optional reason and an idempotency key", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 204 }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      auth: { mode: "dev", devUserId: "user-1" },
      tenantId: "tenant-1",
      fetch,
      newId: idSeq(),
    });

    await client.animals.photos.remove("animal-1", "photo-1", "blurry");
    const req = calls[0]!;
    expect(req.method).toBe("DELETE");
    expect(req.headers["idempotency-key"]).toBeDefined();
    expect(JSON.parse(req.body as string)).toEqual({ reason: "blurry" });
  });
});
