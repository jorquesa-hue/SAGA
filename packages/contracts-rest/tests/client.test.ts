import { describe, expect, it } from "vitest";
import { JkPlatformClient, type ApiError, type FetchLike } from "../src/index.js";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake fetch that records the request and returns a scripted response. */
function fakeFetch(
  script: (req: Captured) => {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
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
    };
  };
  return { fetch, calls };
}

const idSeq = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("JkPlatformClient", () => {
  it("injects dev auth, tenant, correlation, and an idempotency key on commands", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 201,
      body: { id: "t1", name: "Fazenda" },
    }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test/",
      auth: { mode: "dev", devUserId: "user-1", platformAdmin: true },
      tenantId: "tenant-1",
      fetch,
      newId: idSeq(),
    });

    const tenant = await client.tenants.register({ name: "Fazenda" });
    expect(tenant.id).toBe("t1");

    const req = calls[0]!;
    expect(req.url).toBe("https://api.test/api/v1/tenants");
    expect(req.method).toBe("POST");
    expect(req.headers["x-dev-user-id"]).toBe("user-1");
    expect(req.headers["x-dev-platform-admin"]).toBe("true");
    expect(req.headers["x-tenant-id"]).toBe("tenant-1");
    expect(req.headers["x-correlation-id"]).toBeDefined();
    // Mutating verb → idempotency key present.
    expect(req.headers["idempotency-key"]).toBeDefined();
    expect(req.headers["content-type"]).toBe("application/json");
  });

  it("does not attach an idempotency key to GETs and passes query params", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { items: [] } }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      auth: { mode: "bearer", getToken: () => "jwt-abc" },
      tenantId: "tenant-9",
      fetch,
      newId: idSeq(),
    });

    await client.recommendations.list("pending");
    const req = calls[0]!;
    expect(req.method).toBe("GET");
    expect(req.headers["idempotency-key"]).toBeUndefined();
    expect(req.headers.authorization).toBe("Bearer jwt-abc");
    expect(req.url).toContain("status=pending");
  });

  it("honors an explicit idempotency key and per-call tenant override", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 201,
      body: {
        id: "s1",
        url: "https://x",
        eventFamilies: ["animal"],
        active: true,
        secret: "whsec_x",
      },
    }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      fetch,
      newId: idSeq(),
      tenantId: "default",
    });

    await client.webhooks.subscribe(
      { url: "https://x", eventFamilies: ["animal"] },
      { idempotencyKey: "fixed-key-123456", tenantId: "override-tenant" },
    );
    const req = calls[0]!;
    expect(req.headers["idempotency-key"]).toBe("fixed-key-123456");
    expect(req.headers["x-tenant-id"]).toBe("override-tenant");
  });

  it("maps a Problem Details response to a typed ApiError", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 422,
      body: {
        type: "https://jk.example/problems/jk-validation",
        title: "ValidationError",
        status: 422,
        detail: "Invalid input",
        code: "JK-VALIDATION",
        correlationId: "corr-9",
        errors: [{ field: "url", reason: "must be https" }],
      },
    }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      fetch,
      newId: idSeq(),
    });

    await expect(
      client.webhooks.subscribe({ url: "http://x", eventFamilies: ["animal"] }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      code: "JK-VALIDATION",
    });

    try {
      await client.webhooks.subscribe({ url: "http://x", eventFamilies: ["animal"] });
    } catch (e) {
      const err = e as ApiError;
      expect(err.isClientError).toBe(true);
      expect(err.fieldErrors).toEqual([{ field: "url", reason: "must be https" }]);
    }
  });

  it("falls back to a synthetic problem for a non-JSON error body", async () => {
    const { fetch } = fakeFetch(() => ({ status: 500, body: undefined }));
    const client = new JkPlatformClient({
      baseUrl: "https://api.test",
      fetch,
      newId: idSeq(),
    });
    await expect(client.animals.list()).rejects.toMatchObject({
      status: 500,
      code: "JK-HTTP-ERROR",
    });
  });
});
