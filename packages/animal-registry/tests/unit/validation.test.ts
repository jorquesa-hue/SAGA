import { describe, expect, it } from "vitest";
import { ValidationError, newUuid } from "@jk/domain-kernel";
import {
  parseInput,
  registerAnimalInputSchema,
  replaceIdentifierInputSchema,
} from "../../src/domain.js";

describe("registerAnimal input validation", () => {
  it("accepts a minimal valid input with defaults", () => {
    const input = parseInput(
      registerAnimalInputSchema,
      { farmId: newUuid(), visualId: "BR-0001", sex: "female" },
      "register",
    );
    expect(input.breedCode).toBe("BRANGUS");
    expect(input.speciesCode).toBe("BOVINE");
    expect(input.birthDatePrecision).toBe("exact");
  });

  it("rejects a non-UUID farmId and empty visualId", () => {
    expect(() =>
      parseInput(
        registerAnimalInputSchema,
        { farmId: "x", visualId: "BR", sex: "female" },
        "r",
      ),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(
        registerAnimalInputSchema,
        { farmId: newUuid(), visualId: "  ", sex: "female" },
        "r",
      ),
    ).toThrow(ValidationError);
  });

  it("rejects an invalid sex and malformed birthDate", () => {
    expect(() =>
      parseInput(
        registerAnimalInputSchema,
        { farmId: newUuid(), visualId: "A", sex: "F" },
        "r",
      ),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(
        registerAnimalInputSchema,
        { farmId: newUuid(), visualId: "A", sex: "male", birthDate: "01/02/2024" },
        "r",
      ),
    ).toThrow(ValidationError);
  });

  it("rejects unknown properties (strict)", () => {
    expect(() =>
      parseInput(
        registerAnimalInputSchema,
        { farmId: newUuid(), visualId: "A", sex: "male", weight: 300 },
        "r",
      ),
    ).toThrow(ValidationError);
  });

  it("validates replaceIdentifier input", () => {
    const ok = parseInput(
      replaceIdentifierInputSchema,
      { animalId: newUuid(), identifierType: "rfid", newValue: "982000000000099" },
      "replace",
    );
    expect(ok.identifierType).toBe("rfid");
  });
});
