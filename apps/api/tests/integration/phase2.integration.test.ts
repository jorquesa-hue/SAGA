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
  DATABASE_URL: "direct",
  APP_DATABASE_URL: "direct",
  LOG_LEVEL: "error",
};

describe.skipIf(!available)("Phase 2 API — health, reproduction, lots", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let farmId: string;
  let dam: string;

  const owner = () => ({ "x-dev-user-id": ownerId, "x-tenant-id": tenantId });
  const cmd = () => ({ ...owner(), "idempotency-key": newUuid() });

  beforeAll(async () => {
    db = await createTestDatabase("jk_api_p2");
    app = await buildApp({
      config,
      pools: { systemPool: db.adminPool, appPool: db.appPool, close: async () => {} },
      logger: silentLogger,
    });
    await app.ready();

    const tenant = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: { "x-dev-user-id": newUuid(), "x-dev-platform-admin": "true", "idempotency-key": newUuid() },
      payload: { name: "Fazenda P2", owner: { email: "owner@example.com", displayName: "Owner" } },
    });
    tenantId = tenant.json().tenant.id;
    ownerId = tenant.json().ownerUserId;
    const farm = await app.inject({ method: "POST", url: "/api/v1/farms", headers: cmd(), payload: { name: "Sede", areaHa: 100 } });
    farmId = farm.json().id;
    const animal = await app.inject({
      method: "POST",
      url: "/api/v1/animals",
      headers: cmd(),
      payload: { farmId, visualId: "BR-P2-1", sex: "female" },
    });
    dam = animal.json().id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  it("records a treatment with withdrawal and blocks sale-clear, then overrides", async () => {
    const treat = await app.inject({
      method: "POST",
      url: `/api/v1/animals/${dam}/treatments`,
      headers: cmd(),
      payload: {
        productName: "Antibiótico LA",
        administeredAt: new Date(Date.now() - 86400000).toISOString(),
        withdrawalDays: 21,
      },
    });
    expect(treat.statusCode).toBe(201);

    const sale = await app.inject({ method: "GET", url: `/api/v1/animals/${dam}/sale-clear`, headers: owner() });
    expect(sale.json().clear).toBe(false);

    const restrictionId = sale.json().activeRestrictions[0].id;
    const override = await app.inject({
      method: "POST",
      url: `/api/v1/restrictions/${restrictionId}/override`,
      headers: cmd(),
      payload: { reason: "abate de emergência autorizado" },
    });
    expect(override.statusCode).toBe(200);

    const sale2 = await app.inject({ method: "GET", url: `/api/v1/animals/${dam}/sale-clear`, headers: owner() });
    expect(sale2.json().clear).toBe(true);
  });

  it("runs reproduction service → check → status over HTTP", async () => {
    const svc = await app.inject({
      method: "POST",
      url: "/api/v1/reproduction/services",
      headers: cmd(),
      payload: { damId: dam, method: "ai", serviceDate: new Date(Date.now() - 283 * 86400000).toISOString() },
    });
    expect(svc.statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: "/api/v1/reproduction/pregnancy-checks",
      headers: cmd(),
      payload: { damId: dam, serviceId: svc.json().id, checkDate: new Date().toISOString(), result: "positive" },
    });

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/animals/${dam}/reproduction-status`,
      headers: owner(),
    });
    expect(status.json().state).toBe("pregnant");
    expect(status.json().expectedCalvingDate).toBeTruthy();
  });

  it("creates a lot, adds the animal, and projects membership over HTTP", async () => {
    const lot = await app.inject({
      method: "POST",
      url: "/api/v1/lots",
      headers: cmd(),
      payload: { farmId, name: "Lote P2", purpose: "beef" },
    });
    expect(lot.statusCode).toBe(201);
    const lotId = lot.json().id;

    const add = await app.inject({
      method: "POST",
      url: `/api/v1/lots/${lotId}/animals`,
      headers: cmd(),
      payload: { animalIds: [dam] },
    });
    expect(add.json().results[0].status).toBe("added");

    const members = await app.inject({ method: "GET", url: `/api/v1/lots/${lotId}/members`, headers: owner() });
    expect(members.json().items).toContain(dam);
  });

  it("requires Idempotency-Key on treatment commands (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/animals/${dam}/treatments`,
      headers: owner(),
      payload: { productName: "X", administeredAt: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("JK-MISSING-HEADER");
  });
});

describe.skipIf(available)("Phase 2 API (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
