import { ConflictError, NotFoundError, newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import {
  createTestDatabase,
  databaseAvailable,
  makeIdentityService,
  makeTenantContext,
  seedTenantWithOwner,
  type TestDatabase,
} from "@jk/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InventoryForbiddenError, InventoryService } from "../../src/index.js";

const available = databaseAvailable();

describe.skipIf(!available)("InventoryService (integration)", () => {
  let db: TestDatabase;
  let inv: InventoryService;
  let identity: ReturnType<typeof makeIdentityService>;
  let owner: TenantContext;
  let tenantId: Uuid;

  beforeAll(async () => {
    db = await createTestDatabase("jk_inv");
    identity = makeIdentityService(db);
    inv = new InventoryService({ appPool: db.appPool, environment: "test" });
    const seeded = await seedTenantWithOwner(identity, "Fazenda Estoque", "owner@example.com");
    tenantId = seeded.tenantId;
    owner = seeded.ownerContext;
  }, 90_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("receives and consumes stock with a calculated balance", async () => {
    const item = await inv.createItem(owner, { name: "Vermífugo", category: "medicine", unit: "mL" });
    const r = await inv.receiveStock(owner, {
      itemId: item.id,
      quantity: 1000,
      batchCode: "LOTE-1",
      expirationDate: "2027-01-01",
    });
    expect(r.balance).toBe(1000);

    const c = await inv.consumeStock(owner, { itemId: item.id, quantity: 250, reason: "tratamento lote A" });
    expect(c.balance).toBe(750);
    expect(await inv.getBalance(owner, item.id)).toBe(750);
  });

  it("prohibits negative stock by default (JK-INV-002/005)", async () => {
    const item = await inv.createItem(owner, { name: "Sal Mineral", category: "mineral", unit: "kg" });
    await inv.receiveStock(owner, { itemId: item.id, quantity: 50 });
    await expect(
      inv.consumeStock(owner, { itemId: item.id, quantity: 80 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await inv.getBalance(owner, item.id)).toBe(50);
  });

  it("links consumption to an animal/lot (JK-INV-003)", async () => {
    const item = await inv.createItem(owner, { name: "Antibiótico", category: "medicine", unit: "mL" });
    await inv.receiveStock(owner, { itemId: item.id, quantity: 100 });
    const animalId = newUuid();
    await inv.consumeStock(owner, { itemId: item.id, quantity: 10, animalId });
    const movement = await db.adminPool.query(
      `SELECT animal_id FROM stock_movement WHERE item_id = $1 AND movement_type = 'consumption'`,
      [item.id],
    );
    expect(movement.rows[0].animal_id).toBe(animalId);
  });

  it("stock movements are immutable (append-only ledger)", async () => {
    const item = await inv.createItem(owner, { name: "Ração", category: "feed", unit: "kg" });
    await inv.receiveStock(owner, { itemId: item.id, quantity: 500 });
    await expect(
      db.adminPool.query(`UPDATE stock_movement SET quantity_delta = 9999 WHERE item_id = $1`, [item.id]),
    ).rejects.toThrow(/append-only/);
  });

  it("lists batches expiring within the horizon (JK-INV-005)", async () => {
    const item = await inv.createItem(owner, { name: "Vacina", category: "medicine", unit: "dose" });
    await inv.receiveStock(owner, { itemId: item.id, quantity: 40, batchCode: "V-SOON", expirationDate: "2026-08-01" });
    await inv.receiveStock(owner, { itemId: item.id, quantity: 40, batchCode: "V-LATER", expirationDate: "2030-01-01" });
    const expiring = await inv.getExpiringBatches(owner, 60);
    expect(expiring.some((b) => b.batchCode === "V-SOON")).toBe(true);
    expect(expiring.some((b) => b.batchCode === "V-LATER")).toBe(false);
  });

  it("rejects a duplicate item name and a missing item", async () => {
    await inv.createItem(owner, { name: "Único", category: "consumable", unit: "un" });
    await expect(
      inv.createItem(owner, { name: "Único", category: "consumable", unit: "un" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      inv.receiveStock(owner, { itemId: newUuid(), quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("denies a finance_user from changing inventory (403)", async () => {
    const invite = await identity.inviteUser(owner, { email: "fin@example.com", displayName: "Fin", role: "finance_user" });
    await identity.activateMembership(owner, { userId: invite.userId, role: "finance_user" });
    const finance = makeTenantContext(tenantId, invite.userId);
    await expect(
      inv.createItem(finance, { name: "Proibido", category: "feed", unit: "kg" }),
    ).rejects.toBeInstanceOf(InventoryForbiddenError);
  });

  it("does not leak inventory across tenants", async () => {
    const item = await inv.createItem(owner, { name: "Secreto", category: "feed", unit: "kg" });
    const other = await seedTenantWithOwner(identity, "Outra", "o@example.com");
    await expect(inv.getBalance(other.ownerContext, item.id)).resolves.toBe(0);
  });
});

describe.skipIf(available)("InventoryService (PostgreSQL unavailable)", () => {
  it("skips when no database is reachable", () => {
    expect(true).toBe(true);
  });
});
