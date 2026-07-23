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
  CORS_ORIGINS: "",
};

/**
 * Full cross-context farm workflow, driven through the real HTTP API in-process
 * (buildApp + app.inject). Touches identity → animal registry → health →
 * exports → search, and proves the flagship rule: an active medicine withdrawal
 * blocks sale clearance (scenario #8), and the traceability packet (JK-ANI-006)
 * reflects the animal's cross-context history.
 */
describe.skipIf(!available)("End-to-end farm scenario (integration)", () => {
  let db: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = await createTestDatabase("jk_e2e");
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

  const cmd = (userId: string, tenantId?: string) => ({
    "x-dev-user-id": userId,
    ...(tenantId ? { "x-tenant-id": tenantId } : {}),
    "idempotency-key": newUuid(),
  });
  const read = (userId: string, tenantId: string) => ({ "x-dev-user-id": userId, "x-tenant-id": tenantId });

  it("registers → treats → withdrawal blocks sale → exports packet → search finds it", async () => {
    // 1. Platform admin onboards a tenant with its owner.
    const tenantRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: { ...cmd(newUuid()), "x-dev-platform-admin": "true" },
      payload: { name: "Fazenda E2E", owner: { email: "dono@example.com", displayName: "Dono" } },
    });
    expect(tenantRes.statusCode).toBe(201);
    const tenantId = tenantRes.json().tenant.id as string;
    const ownerId = tenantRes.json().ownerUserId as string;

    // 2. Owner creates a farm.
    const farmRes = await app.inject({ method: "POST", url: "/api/v1/farms", headers: cmd(ownerId, tenantId), payload: { name: "Sede E2E", areaHa: 120 } });
    expect(farmRes.statusCode).toBe(201);
    const farmId = farmRes.json().id as string;

    // 3. Owner registers an animal.
    const animalRes = await app.inject({
      method: "POST",
      url: "/api/v1/animals",
      headers: cmd(ownerId, tenantId),
      payload: { farmId, visualId: "BR-E2E-1", sex: "female", breedCode: "BRANGUS", rfid: "982000000E2E001" },
    });
    expect(animalRes.statusCode).toBe(201);
    const animalId = animalRes.json().id as string;

    // 4. Owner records a treatment with a withdrawal period → creates a restriction.
    const treatRes = await app.inject({
      method: "POST",
      url: `/api/v1/animals/${animalId}/treatments`,
      headers: cmd(ownerId, tenantId),
      payload: { kind: "treatment", productName: "Ivermectina", administeredAt: new Date().toISOString(), withdrawalDays: 30 },
    });
    expect(treatRes.statusCode).toBe(201);

    // 5. Sale clearance is BLOCKED while the withdrawal is active (scenario #8).
    const clearRes = await app.inject({ method: "GET", url: `/api/v1/animals/${animalId}/sale-clear`, headers: read(ownerId, tenantId) });
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json().clear).toBe(false);
    expect(clearRes.json().activeRestrictions.length).toBeGreaterThan(0);

    // 6. The restriction is visible on the animal.
    const restrRes = await app.inject({ method: "GET", url: `/api/v1/animals/${animalId}/restrictions`, headers: read(ownerId, tenantId) });
    expect(restrRes.json().items.some((r: { restrictionType: string }) => r.restrictionType === "withdrawal")).toBe(true);

    // 7. Traceability packet (JK-ANI-006): request → process → download.
    const exportRes = await app.inject({
      method: "POST",
      url: "/api/v1/exports",
      headers: cmd(ownerId, tenantId),
      payload: { exportType: "animal_traceability_packet", format: "json", params: { animalId } },
    });
    expect(exportRes.statusCode).toBe(202);
    const exportId = exportRes.json().id as string;

    const processRes = await app.inject({ method: "POST", url: `/api/v1/exports/${exportId}/process`, headers: cmd(ownerId, tenantId) });
    expect(processRes.json().status).toBe("completed");

    const downloadRes = await app.inject({ method: "GET", url: `/api/v1/exports/${exportId}/download`, headers: read(ownerId, tenantId) });
    expect(downloadRes.statusCode).toBe(200);
    const packet = JSON.parse(downloadRes.body);
    expect(packet.animal.visual_id).toBe("BR-E2E-1");
    expect(packet.restrictions.some((r: { restriction_type: string }) => r.restriction_type === "withdrawal")).toBe(true);
    expect(packet.identifiers.some((i: { identifier_value: string }) => i.identifier_value === "982000000E2E001")).toBe(true);

    // 8. Global search finds the animal by visual id and by RFID.
    const searchRes = await app.inject({ method: "GET", url: "/api/v1/search?q=BR-E2E", headers: read(ownerId, tenantId) });
    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.json().animals.some((a: { label: string }) => a.label === "BR-E2E-1")).toBe(true);

    const rfidSearch = await app.inject({ method: "GET", url: "/api/v1/search?q=982000000E2E001", headers: read(ownerId, tenantId) });
    expect(rfidSearch.json().animals.length).toBeGreaterThanOrEqual(1);
  });

  it("enforces the tenant base currency on finance writes and reports margin in it", async () => {
    // A tenant whose books are kept in USD.
    const tenantRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: { ...cmd(newUuid()), "x-dev-platform-admin": "true" },
      payload: { name: "Rancho USD", defaultCurrency: "USD", owner: { email: "usd@example.com", displayName: "USD Owner" } },
    });
    expect(tenantRes.statusCode).toBe(201);
    const tenantId = tenantRes.json().tenant.id as string;
    const ownerId = tenantRes.json().ownerUserId as string;

    // Matching currency is accepted.
    const okRes = await app.inject({
      method: "POST",
      url: "/api/v1/finance/expenses",
      headers: cmd(ownerId, tenantId),
      payload: { category: "feed", amount: "100.00", currency: "USD" },
    });
    expect(okRes.statusCode).toBe(201);

    // An absent currency defaults to the tenant base (still accepted).
    const defaultRes = await app.inject({
      method: "POST",
      url: "/api/v1/finance/revenue",
      headers: cmd(ownerId, tenantId),
      payload: { category: "sale", amount: "250.00" },
    });
    expect(defaultRes.statusCode).toBe(201);

    // A mismatched currency is rejected (no FX): 422 JK-CURRENCY-MISMATCH.
    const badRes = await app.inject({
      method: "POST",
      url: "/api/v1/finance/expenses",
      headers: cmd(ownerId, tenantId),
      payload: { category: "feed", amount: "100.00", currency: "BRL" },
    });
    expect(badRes.statusCode).toBe(422);
    expect(badRes.json().code).toBe("JK-CURRENCY-MISMATCH");

    // Margin reads report the tenant currency.
    const marginRes = await app.inject({ method: "GET", url: `/api/v1/lots/${newUuid()}/margin`, headers: read(ownerId, tenantId) });
    expect(marginRes.statusCode).toBe(200);
    expect(marginRes.json().currency).toBe("USD");
  });
});

describe.skipIf(available)("End-to-end farm scenario (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
