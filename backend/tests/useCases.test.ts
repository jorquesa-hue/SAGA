import { describe, it, expect, beforeEach } from "vitest";
import { SagaService } from "../src/application/useCases.js";
import { createInMemoryRepositories } from "../src/infrastructure/persistence/inMemory.js";
import { NotFoundError } from "../src/domain/shared/errors.js";

const ORG = "org-1";

describe("SagaService", () => {
  let service: SagaService;
  beforeEach(() => {
    service = new SagaService(createInMemoryRepositories());
  });

  it("creates and lists farms scoped to an organization", async () => {
    await service.createFarm({ organizationId: ORG, name: "Finca A", totalAreaHa: 50 });
    await service.createFarm({ organizationId: "org-2", name: "Finca B", totalAreaHa: 30 });

    const farms = await service.listFarms(ORG);
    expect(farms).toHaveLength(1);
    expect(farms[0]!.name).toBe("Finca A");
  });

  it("registers a parcel only under an existing farm", async () => {
    const farm = await service.createFarm({ organizationId: ORG, name: "Finca A", totalAreaHa: 50 });
    const parcel = await service.registerParcel({
      organizationId: ORG,
      farmId: farm.id,
      code: "P-01",
      areaHa: 10,
    });
    expect(parcel.farmId).toBe(farm.id);

    await expect(
      service.registerParcel({ organizationId: ORG, farmId: "missing", code: "P", areaHa: 5 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("opens a crop cycle bounded by the parcel area and advances it", async () => {
    const farm = await service.createFarm({ organizationId: ORG, name: "Finca A", totalAreaHa: 50 });
    const parcel = await service.registerParcel({
      organizationId: ORG,
      farmId: farm.id,
      code: "P-01",
      areaHa: 10,
    });
    const cycle = await service.openCropCycle({
      organizationId: ORG,
      parcelId: parcel.id,
      crop: "Olivar",
      cultivatedAreaHa: 9,
    });
    expect(cycle.status).toBe("planned");

    const advanced = await service.advanceCropCycle(ORG, cycle.id, "active");
    expect(advanced.status).toBe("active");
  });

  it("does not open a crop cycle on a missing parcel", async () => {
    await expect(
      service.openCropCycle({ organizationId: ORG, parcelId: "nope", crop: "X", cultivatedAreaHa: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates and lists partners", async () => {
    await service.createPartner({ organizationId: ORG, name: "Cooperativa", kind: "both" });
    const partners = await service.listPartners(ORG);
    expect(partners).toHaveLength(1);
  });
});
