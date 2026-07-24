import { newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FinanceForbiddenError, FinanceService } from "../../src/index.js";

const available = databaseAvailable();

describe.skipIf(!available)("FinanceService (integration)", () => {
  let db: TestDatabase;
  let finance: FinanceService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;
  let farmId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_finance");
    identity = makeIdentityService(db);
    finance = new FinanceService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(
      identity,
      "Fazenda Financeira",
      "owner@example.com",
    );
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
    const farm = await identity.createFarm(owner, { name: "Sede", areaHa: 100 });
    farmId = farm.id;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("records an expense split losslessly across two lots (JK-FIN-002/003)", async () => {
    const lotA = newUuid();
    const lotB = newUuid();
    await finance.recordExpense(owner, {
      category: "feed",
      amount: "100.01",
      farmId,
      allocations: [
        { dimension: "lot", targetId: lotA, weight: 1 },
        { dimension: "lot", targetId: lotB, weight: 1 },
      ],
    });
    const costA = await finance.getCostForTarget(owner, "lot", lotA);
    const costB = await finance.getCostForTarget(owner, "lot", lotB);
    // 100.01 split 1:1 → 50.01 + 50.00 (no cent lost).
    const sum = Number(costA) + Number(costB);
    expect(sum).toBeCloseTo(100.01, 2);
    expect(["50.00", "50.01"]).toContain(costA);
  });

  it("records a sale computing net receipt and posting revenue (JK-FIN-005)", async () => {
    const lotId = newUuid();
    const sale = await finance.recordSale(owner, {
      lotId,
      weightKg: 5000,
      priceBasis: "R$/@ x arrobas",
      gross: "20000.00",
      deductions: "500.00",
      freight: "1500.00",
    });
    expect(sale.netReceipt).toBe("18000.00");

    const margin = await finance.getMarginForLot(owner, lotId);
    expect(margin.revenue).toBe("18000.00");
    expect(margin.cost).toBe("0.00");
    expect(margin.margin).toBe("18000.00");
  });

  it("computes lot margin as revenue minus allocated cost", async () => {
    const lotId = newUuid();
    await finance.recordExpense(owner, {
      category: "health",
      amount: "3000.00",
      allocations: [{ dimension: "lot", targetId: lotId, weight: 1 }],
    });
    await finance.recordSale(owner, { lotId, gross: "10000.00" });
    const margin = await finance.getMarginForLot(owner, lotId);
    expect(margin.cost).toBe("3000.00");
    expect(margin.revenue).toBe("10000.00");
    expect(margin.margin).toBe("7000.00");
  });

  it("tracks monthly budget variance (JK-FIN-004)", async () => {
    await finance.setBudget(owner, {
      periodMonth: "2026-07",
      category: "fuel",
      planned: "5000.00",
    });
    await finance.recordExpense(owner, {
      category: "fuel",
      amount: "1200.00",
      occurredAt: "2026-07-15T12:00:00.000Z",
    });
    const variance = await finance.getBudgetVariance(owner, "2026-07", "fuel");
    expect(variance.planned).toBe("5000.00");
    expect(variance.actual).toBe("1200.00");
    expect(variance.variance).toBe("3800.00");
  });

  it("rejects a sale whose deductions exceed gross", async () => {
    await expect(
      finance.recordSale(owner, {
        lotId: newUuid(),
        gross: "100.00",
        deductions: "150.00",
      }),
    ).rejects.toThrow(/negative/i);
  });

  it("financial entries are immutable (append-only)", async () => {
    await finance.recordExpense(owner, { category: "misc", amount: "10.00", farmId });
    await expect(
      db.adminPool.query(
        `UPDATE financial_entry SET amount_minor = 1 WHERE category = 'misc'`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("denies a technician from recording finance (403)", async () => {
    const invite = await identity.inviteUser(owner, {
      email: "tec@example.com",
      displayName: "Tec",
      role: "technician",
    });
    await identity.activateMembership(owner, {
      userId: invite.userId,
      role: "technician",
    });
    const tech = makeTenantContext(tenantId, invite.userId);
    await expect(
      finance.recordExpense(tech, { category: "x", amount: "1.00" }),
    ).rejects.toBeInstanceOf(FinanceForbiddenError);
  });

  it("does not leak finance across tenants", async () => {
    const lotId = newUuid();
    await finance.recordExpense(owner, {
      category: "feed",
      amount: "500.00",
      allocations: [{ dimension: "lot", targetId: lotId, weight: 1 }],
    });
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(
      finance.getCostForTarget(other.ownerContext, "lot", lotId),
    ).resolves.toBe("0.00");
  });
});

describe.skipIf(available)("FinanceService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
