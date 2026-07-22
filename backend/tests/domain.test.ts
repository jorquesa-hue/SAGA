import { describe, it, expect } from "vitest";
import { Farm } from "../src/domain/farm.js";
import { Parcel } from "../src/domain/parcel.js";
import { CropCycle } from "../src/domain/cropCycle.js";
import { Partner } from "../src/domain/partner.js";
import { DomainError } from "../src/domain/shared/errors.js";

const ORG = "org-1";

describe("Farm", () => {
  it("creates a valid farm", () => {
    const farm = Farm.create({ organizationId: ORG, name: "Finca La Esperanza", totalAreaHa: 120.5 });
    expect(farm.name).toBe("Finca La Esperanza");
    expect(farm.totalAreaHa).toBe(120.5);
  });

  it("rejects empty name", () => {
    expect(() => Farm.create({ organizationId: ORG, name: "  ", totalAreaHa: 10 })).toThrow(DomainError);
  });

  it("rejects negative area", () => {
    expect(() => Farm.create({ organizationId: ORG, name: "X", totalAreaHa: -1 })).toThrow(DomainError);
  });
});

describe("Parcel", () => {
  it("creates a valid parcel with default rainfed irrigation", () => {
    const p = Parcel.create({ organizationId: ORG, farmId: "f1", code: "P-01", areaHa: 5 });
    expect(p.areaHa).toBe(5);
    expect(p.toJSON().irrigation).toBe("rainfed");
  });

  it("rejects zero area", () => {
    expect(() => Parcel.create({ organizationId: ORG, farmId: "f1", code: "P", areaHa: 0 })).toThrow(
      DomainError,
    );
  });
});

describe("CropCycle", () => {
  it("creates a planned cycle within parcel area", () => {
    const c = CropCycle.create({
      organizationId: ORG,
      parcelId: "p1",
      parcelAreaHa: 10,
      crop: "Trigo blando",
      cultivatedAreaHa: 8,
    });
    expect(c.status).toBe("planned");
  });

  it("rejects cultivated area exceeding parcel area", () => {
    expect(() =>
      CropCycle.create({
        organizationId: ORG,
        parcelId: "p1",
        parcelAreaHa: 10,
        crop: "Trigo",
        cultivatedAreaHa: 12,
      }),
    ).toThrow(DomainError);
  });

  it("advances forward through statuses", () => {
    const c = CropCycle.create({
      organizationId: ORG,
      parcelId: "p1",
      parcelAreaHa: 10,
      crop: "Trigo",
      cultivatedAreaHa: 8,
    });
    c.advanceTo("active");
    c.advanceTo("harvested");
    expect(c.status).toBe("harvested");
  });

  it("refuses to move backwards", () => {
    const c = CropCycle.create({
      organizationId: ORG,
      parcelId: "p1",
      parcelAreaHa: 10,
      crop: "Trigo",
      cultivatedAreaHa: 8,
    });
    c.advanceTo("active");
    expect(() => c.advanceTo("planned")).toThrow(DomainError);
  });
});

describe("Partner", () => {
  it("creates a supplier", () => {
    const p = Partner.create({ organizationId: ORG, name: "Agroquímicos SL", kind: "supplier" });
    expect(p.toJSON().kind).toBe("supplier");
  });

  it("rejects an invalid email", () => {
    expect(() =>
      Partner.create({ organizationId: ORG, name: "X", kind: "customer", email: "not-an-email" }),
    ).toThrow(DomainError);
  });
});
