import { describe, expect, it } from "vitest";
import { ValidationError, newUuid } from "@jk/domain-kernel";
import {
  addPhotoInputSchema,
  parseInput,
  registerAnimalInputSchema,
  removePhotoInputSchema,
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

  it("accepts every supported species and rejects an unsupported one", () => {
    for (const speciesCode of ["BOVINE", "PORCINE", "OVINE", "CAPRINE", "EQUINE"]) {
      const input = parseInput(
        registerAnimalInputSchema,
        { farmId: newUuid(), visualId: "A", sex: "male", speciesCode },
        "r",
      );
      expect(input.speciesCode).toBe(speciesCode);
    }
    expect(() =>
      parseInput(
        registerAnimalInputSchema,
        { farmId: newUuid(), visualId: "A", sex: "male", speciesCode: "CANINE" },
        "r",
      ),
    ).toThrow(ValidationError);
  });
});

describe("photo input validation", () => {
  const validPhoto = {
    animalId: newUuid(),
    takenAt: "2026-01-15",
    storageKey: "tenant/animal/photo.jpg",
    contentType: "image/jpeg",
    byteSize: 1024,
    checksumSha256: "a".repeat(64),
  };

  it("accepts a valid addPhoto input", () => {
    const input = parseInput(addPhotoInputSchema, validPhoto, "addPhoto");
    expect(input.contentType).toBe("image/jpeg");
  });

  it("rejects an unsupported content type", () => {
    expect(() =>
      parseInput(
        addPhotoInputSchema,
        { ...validPhoto, contentType: "application/pdf" },
        "addPhoto",
      ),
    ).toThrow(ValidationError);
  });

  it("rejects a byteSize over the cap and a malformed checksum", () => {
    expect(() =>
      parseInput(
        addPhotoInputSchema,
        { ...validPhoto, byteSize: 20 * 1024 * 1024 },
        "addPhoto",
      ),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(addPhotoInputSchema, { ...validPhoto, checksumSha256: "not-hex" }, "addPhoto"),
    ).toThrow(ValidationError);
  });

  it("rejects a malformed takenAt date", () => {
    expect(() =>
      parseInput(addPhotoInputSchema, { ...validPhoto, takenAt: "15/01/2026" }, "addPhoto"),
    ).toThrow(ValidationError);
  });

  it("validates removePhoto input", () => {
    const ok = parseInput(
      removePhotoInputSchema,
      { animalId: newUuid(), photoId: newUuid(), reason: "blurry" },
      "removePhoto",
    );
    expect(ok.reason).toBe("blurry");
  });
});
