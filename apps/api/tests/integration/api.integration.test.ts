import { newUuid } from "@jk/domain-kernel";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "@jk/testkit";
import { silentLogger } from "@jk/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { ApiConfig } from "../../src/config.js";

const available = databaseAvailable();

const config: ApiConfig = {
  APP_ENV: "local",
  PORT: 0,
  HOST: "127.0.0.1",
  DATABASE_URL: "unused-direct-pools",
  APP_DATABASE_URL: "unused-direct-pools",
  LOG_LEVEL: "error",
  AI_ENABLED: false,
  CORS_ORIGINS: "https://console.example",
};

function admin(userId: string) {
  return {
    "x-dev-user-id": userId,
    "x-dev-platform-admin": "true",
    "idempotency-key": newUuid(),
  };
}

function asUser(userId: string, tenantId: string) {
  return {
    "x-dev-user-id": userId,
    "x-tenant-id": tenantId,
    "idempotency-key": newUuid(),
  };
}

describe.skipIf(!available)("JK API (integration)", () => {
  let db: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = await createTestDatabase("jk_api");
    app = await buildApp({
      config,
      pools: { systemPool: db.adminPool, appPool: db.appPool, close: async () => {} },
      logger: silentLogger,
    });
    await app.ready();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  // --- Health --------------------------------------------------------------

  it("health probes respond without auth", async () => {
    const live = await app.inject({ method: "GET", url: "/health/live" });
    expect(live.statusCode).toBe(200);
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.appDb).toBe("ok");
  });

  it("echoes a correlation id header", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.headers["x-correlation-id"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("allows a configured CORS origin and rejects an unlisted one (§46)", async () => {
    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/farms",
      headers: {
        origin: "https://console.example",
        "access-control-request-method": "GET",
      },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://console.example",
    );

    const denied = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/farms",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // --- Auth ----------------------------------------------------------------

  it("rejects business requests without authentication (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/farms" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("JK-UNAUTHORIZED");
  });

  // --- Happy path: tenant -> farm -> invite --------------------------------

  let tenantAId: string;
  let ownerAId: string;

  it("creates a tenant as platform admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: admin(newUuid()),
      payload: {
        name: "Fazenda Aurora",
        owner: { email: "ana@example.com", displayName: "Ana" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenant.name).toBe("Fazenda Aurora");
    expect(body.ownerUserId).toBeTruthy();
    tenantAId = body.tenant.id;
    ownerAId = body.ownerUserId;
  });

  it("rejects tenant creation without platform admin (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: { "x-dev-user-id": newUuid(), "idempotency-key": newUuid() },
      payload: { name: "Nao Autorizada" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("JK-FORBIDDEN");
  });

  it("creates a farm as the tenant owner (201) and lists it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/farms",
      headers: asUser(ownerAId, tenantAId),
      payload: { name: "Sede Aurora", areaHa: 100 },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().name).toBe("Sede Aurora");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/farms",
      headers: { "x-dev-user-id": ownerAId, "x-tenant-id": tenantAId },
    });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().items.some((f: { name: string }) => f.name === "Sede Aurora"),
    ).toBe(true);
  });

  it("returns 409 on a duplicate farm name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/farms",
      headers: asUser(ownerAId, tenantAId),
      payload: { name: "Sede Aurora" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("JK-CONFLICT");
  });

  it("requires an Idempotency-Key on commands (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/farms",
      headers: { "x-dev-user-id": ownerAId, "x-tenant-id": tenantAId },
      payload: { name: "Sem Chave" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("JK-MISSING-HEADER");
  });

  it("validates the body (422 domain invariant on empty name)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/farms",
      headers: asUser(ownerAId, tenantAId),
      payload: { name: "   " },
    });
    expect([400, 422]).toContain(res.statusCode);
    expect(res.json().correlationId).toBeTruthy();
  });

  it("invites a user as owner (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/invitations",
      headers: asUser(ownerAId, tenantAId),
      payload: { email: "tecnico@example.com", displayName: "Téo", role: "technician" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("invited");
  });

  // --- Cross-tenant attack -------------------------------------------------

  it("denies a user selecting a tenant they do not belong to (403)", async () => {
    // Create tenant B with its own owner.
    const createB = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: admin(newUuid()),
      payload: {
        name: "Rancho Boa Vista",
        owner: { email: "bruno@example.com", displayName: "Bruno" },
      },
    });
    const ownerBId = createB.json().ownerUserId as string;

    // B's owner points x-tenant-id at tenant A.
    const attack = await app.inject({
      method: "GET",
      url: "/api/v1/farms",
      headers: { "x-dev-user-id": ownerBId, "x-tenant-id": tenantAId },
    });
    expect(attack.statusCode).toBe(403);
    expect(attack.json().code).toBe("JK-FORBIDDEN");
  });

  // --- Not found + docs ----------------------------------------------------

  it("returns a Problem Details 404 for unknown (authenticated) routes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/nope",
      headers: { "x-dev-user-id": ownerAId },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().code).toBe("JK-ROUTE-NOT-FOUND");
  });

  it("serves the authored OpenAPI document", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/openapi.yaml" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("openapi:");
  });

  it("wrote a farm_created domain event + outbox row (auditable)", async () => {
    const events = await db.adminPool.query(
      `SELECT event_type FROM domain_event WHERE tenant_id = $1 AND event_type = 'identity.farm_created.v1'`,
      [tenantAId],
    );
    expect(events.rows.length).toBeGreaterThanOrEqual(1);
    const outbox = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM outbox_message WHERE tenant_id = $1`,
      [tenantAId],
    );
    expect(outbox.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe.skipIf(available)("JK API (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
