import type { SpeciesCode } from "@jk/contracts-rest";

/**
 * Species and suggested-breed catalog for the register form (mirrors the
 * server's species CHECK constraint — database/migrations/0022). apps/web is
 * a browser bundle and cannot import the server-side animal-registry
 * package, so the species set is duplicated here as UI data, same as
 * ./i18n/enums.ts duplicates other controlled vocabularies for display.
 *
 * Breed lists are suggestions only (a datalist, not an enum): the API
 * accepts any breedCode string, matching how BOVINE breeds already work.
 */
export interface SpeciesOption {
  code: SpeciesCode;
  suggestedBreeds: string[];
}

export const SPECIES_OPTIONS: SpeciesOption[] = [
  {
    code: "BOVINE",
    suggestedBreeds: ["BRANGUS", "NELORE", "ANGUS", "GIR", "GIROLANDO", "SENEPOL"],
  },
  {
    code: "PORCINE",
    suggestedBreeds: ["LANDRACE", "LARGE_WHITE", "DUROC", "PIETRAIN"],
  },
  {
    code: "OVINE",
    suggestedBreeds: ["SANTA_INES", "DORPER", "TEXEL", "ILE_DE_FRANCE"],
  },
  {
    code: "CAPRINE",
    suggestedBreeds: ["BOER", "SAANEN", "ALPINA", "ANGLO_NUBIANA"],
  },
  {
    code: "EQUINE",
    suggestedBreeds: ["QUARTO_DE_MILHA", "MANGALARGA", "CRIOULO", "CAMPOLINA"],
  },
];

export function suggestedBreedsFor(speciesCode: string): string[] {
  return SPECIES_OPTIONS.find((s) => s.code === speciesCode)?.suggestedBreeds ?? [];
}
