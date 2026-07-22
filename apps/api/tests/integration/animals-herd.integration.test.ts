import { newUuid } from "@jk/domain-kernel";
import { silentLogger } from "@jk/observability";
import { createTestDatabase, databaseAvailable, type TestDatabase } from "@jk/testkit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { ApiConfig } from "../../src/config.js";

const available = databaseAvailable();

const config: ApiConfig = {
  APP_ENV: "local",
  PORT: 0,
  HOST: "127.0.0.1",
  DATABASE_URL: "direct-pools",
  APP_DATABASE_URL: "direct-pools",
  LOG_LEVEL: "error",
};

describe.skipIf(!available)("Animal + Herd API (integration)", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let farmId: string;
  let animalId: string;

  const owner = () => ({ "x-dev-user-id": ownerId, "x-tenant-id": tenantId });
  const cmd = () => ({ ...owner(), "idempotency-key": newUuid() });

  beforeAll(async () => {
    db = await createTestDatabase("jk_api_herd");
    app = await buildApp({
      config,
      pools: { systemPool: db.adminPool, appPool: db.appPool, close: async () => {} },
      logger: silentLogger,
    });
    await app.ready();

    // Bootstrap a tenant + owner + farm through the API.
    const tenant = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: { "x-dev-user-id": newUuid(), "x-dev-platform-admin": "true", "idempotency-key": newUuid() },
      payload: { name: "Fazenda API", owner: { email: "owner@example.com", displayName: "Owner" } },
    });
    tenantId = tenant.json().tenant.id;
    ownerId = tenant.json().ownerUserId;
    const farm = await app.inject({ method: "POST", url: "/api/v1/farms", headers: cmd(), payload: { name: "Sede", areaHa: 100 } });
    farmId = farm.json().id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  it("registers an animal (201) and reads it back", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/animals",
      headers: cmd(),
      payload: { farmId, visualId: "BR-API-1", sex: "female", rfid: "982000000000501" },
    });
    expect(res.statusCode).toBe(201);
    animalId = res.json().id;
    expect(res.json().version).toBe(1);

    const get = await app.inject({ method: "GET", url: `/api/v1/animals/${animalId}`, headers: owner() });
    expect(get.statusCode).toBe(200);
    expect(get.json().visualId).toBe("BR-API-1");
  });

  it("returns the animal timeline", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/animals/${animalId}/timeline`, headers: owner() });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.some((e: { eventType: string }) => e.eventType === "animal.animal_registered.v1")).toBe(true);
  });

  it("runs a handling session: start, record weight, weights, ADG, close", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/api/v1/handling-sessions",
      headers: cmd(),
      payload: { farmId, purpose: "weighing", expectedCount: 1 },
    });
    expect(start.statusCode).toBe(201);
    const sessionId = start.json().id;

    const obs1 = await app.inject({
      method: "POST",
      url: `/api/v1/handling-sessions/${sessionId}/observations`,
      headers: owner(),
      payload: {
        observationId: "api-obs-1",
        capturedAt: new Date(Date.now() - 60 * 86400000).toISOString(),
        value: 200,
        unit: "kg",
        rfid: "982000000000501",
      },
    });
    expect(obs1.statusCode).toBe(201);
    expect(obs1.json().status).toBe("accepted");

    await app.inject({
      method: "POST",
      url: `/api/v1/handling-sessions/${sessionId}/observations`,
      headers: owner(),
      payload: {
        observationId: "api-obs-2",
        capturedAt: new Date().toISOString(),
        value: 260,
        unit: "kg",
        rfid: "982000000000501",
      },
    });

    const weights = await app.inject({ method: "GET", url: `/api/v1/animals/${animalId}/weights`, headers: owner() });
    expect(weights.json().items).toHaveLength(2);

    const adg = await app.inject({ method: "GET", url: `/api/v1/animals/${animalId}/adg`, headers: owner() });
    expect(adg.json().adgKgPerDay).toBeCloseTo(1.0, 1);

    const close = await app.inject({ method: "POST", url: `/api/v1/handling-sessions/${sessionId}/close`, headers: cmd() });
    expect(close.statusCode).toBe(200);
    expect(close.json().summary.accepted).toBe(2);
  });

  it("ingests a device-observations batch with 207 partial success", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/device-observations:batch",
      headers: owner(),
      payload: {
        observations: [
          { observationId: "b1", gatewayId: "gw", capturedAt: new Date().toISOString(), value: 305, unit: "kg", rfid: "982000000000501" },
          { observationId: "b2", gatewayId: "gw", capturedAt: new Date().toISOString(), value: 0, unit: "kg", rfid: "982000000000501" },
          { observationId: "b3", gatewayId: "gw", capturedAt: new Date().toISOString(), value: 288, unit: "kg", rfid: "982000000009999" },
        ],
      },
    });
    expect(res.statusCode).toBe(207);
    const statuses = res.json().results.map((r: { status: string }) => r.status);
    expect(statuses).toContain("accepted");
    expect(statuses).toContain("rejected_validation");
    expect(statuses).toContain("pending_resolution");
  });

  it("denies a non-herd role from registering (403)", async () => {
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/users/invitations",
      headers: cmd(),
      payload: { email: "aud@example.com", displayName: "Aud", role: "auditor" },
    });
    const auditorId = invite.json().userId;
    await app.inject({ method: "GET", url: "/api/v1/users", headers: owner() }); // no-op read
    // Activate the auditor membership directly (owner can, via identity service path not exposed; use DB).
    await db.adminPool.query(
      `UPDATE tenant_membership SET status = 'active' WHERE user_id = $1 AND role = 'auditor'`,
      [auditorId],
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/animals",
      headers: { "x-dev-user-id": auditorId, "x-tenant-id": tenantId, "idempotency-key": newUuid() },
      payload: { farmId, visualId: "BR-NO", sex: "female" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("JK-FORBIDDEN");
  });
});

describe.skipIf(available)("Animal + Herd API (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
