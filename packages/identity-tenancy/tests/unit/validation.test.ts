import { ValidationError } from "@jk/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  createFarmInputSchema,
  createTenantInputSchema,
  inviteUserInputSchema,
  membershipChangeInputSchema,
  parseInput,
} from "../../src/domain.js";
import { TENANT_ROLES } from "../../src/roles.js";

describe("createTenant input invariants", () => {
  it("accepts a minimal valid tenant", () => {
    const parsed = parseInput(
      createTenantInputSchema,
      { name: "Fazenda Aurora" },
      "createTenant input",
    );
    expect(parsed.name).toBe("Fazenda Aurora");
  });

  it("rejects empty and whitespace-only names with field errors", () => {
    for (const name of ["", "   "]) {
      try {
        parseInput(createTenantInputSchema, { name }, "createTenant input");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).fieldErrors[0]?.field).toBe("name");
      }
    }
  });

  it("rejects malformed locale and currency", () => {
    expect(() =>
      parseInput(
        createTenantInputSchema,
        { name: "Fazenda Aurora", defaultLocale: "portuguese" },
        "createTenant input",
      ),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(
        createTenantInputSchema,
        { name: "Fazenda Aurora", defaultCurrency: "reais" },
        "createTenant input",
      ),
    ).toThrow(ValidationError);
  });

  it("rejects an invalid owner email", () => {
    expect(() =>
      parseInput(
        createTenantInputSchema,
        { name: "Fazenda Aurora", owner: { email: "not-an-email", displayName: "Ana" } },
        "createTenant input",
      ),
    ).toThrow(ValidationError);
  });
});

describe("createFarm input invariants", () => {
  it("accepts area zero and drops nothing silently", () => {
    const parsed = parseInput(
      createFarmInputSchema,
      { name: "Sede", areaHa: 0 },
      "createFarm input",
    );
    expect(parsed.areaHa).toBe(0);
  });

  it("rejects negative area (area >= 0 invariant)", () => {
    expect(() =>
      parseInput(createFarmInputSchema, { name: "Sede", areaHa: -1 }, "createFarm input"),
    ).toThrow(ValidationError);
  });

  it("rejects empty farm names and non-IANA timezones", () => {
    expect(() =>
      parseInput(createFarmInputSchema, { name: " " }, "createFarm input"),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(
        createFarmInputSchema,
        { name: "Sede", timezone: "brasilia time" },
        "createFarm input",
      ),
    ).toThrow(ValidationError);
  });

  it("rejects unknown fields (strict schema)", () => {
    expect(() =>
      parseInput(
        createFarmInputSchema,
        { name: "Sede", tenantId: "sneaky-override" },
        "createFarm input",
      ),
    ).toThrow(ValidationError);
  });
});

describe("inviteUser input invariants", () => {
  it("accepts every canonical role", () => {
    for (const role of TENANT_ROLES) {
      const parsed = parseInput(
        inviteUserInputSchema,
        { email: "carlos.pereira@example.com", displayName: "Carlos Pereira", role },
        "inviteUser input",
      );
      expect(parsed.role).toBe(role);
    }
  });

  it("rejects invalid emails", () => {
    for (const email of ["", "carlos", "carlos@", "@example.com"]) {
      expect(() =>
        parseInput(
          inviteUserInputSchema,
          { email, displayName: "Carlos Pereira", role: "technician" },
          "inviteUser input",
        ),
      ).toThrow(ValidationError);
    }
  });

  it("rejects non-canonical roles, including platform_admin", () => {
    for (const role of ["platform_admin", "superuser", "owner", ""]) {
      expect(() =>
        parseInput(
          inviteUserInputSchema,
          { email: "carlos.pereira@example.com", displayName: "Carlos Pereira", role },
          "inviteUser input",
        ),
      ).toThrow(ValidationError);
    }
  });
});

describe("membership change input invariants", () => {
  it("requires a UUID userId and a canonical role", () => {
    expect(() =>
      parseInput(
        membershipChangeInputSchema,
        { userId: "not-a-uuid", role: "technician" },
        "activateMembership input",
      ),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(
        membershipChangeInputSchema,
        { userId: "0b013f4a-6f0e-4a70-9d3f-0c1a2b3c4d5e", role: "platform_admin" },
        "activateMembership input",
      ),
    ).toThrow(ValidationError);
    const parsed = parseInput(
      membershipChangeInputSchema,
      { userId: "0b013f4a-6f0e-4a70-9d3f-0c1a2b3c4d5e", role: "veterinarian" },
      "activateMembership input",
    );
    expect(parsed.role).toBe("veterinarian");
  });
});
