import { describe, expect, it } from "vitest";
import { REPORT_DEFINITIONS, findReport } from "../../src/catalog.js";
import { reportRowsToCsv } from "../../src/csv.js";

describe("report catalogue", () => {
  it("exposes a stable, well-formed catalogue", () => {
    expect(REPORT_DEFINITIONS.length).toBeGreaterThanOrEqual(8);
    const keys = REPORT_DEFINITIONS.map((d) => d.key);
    // Keys are unique.
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of REPORT_DEFINITIONS) {
      expect(d.key).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      expect(d.titleKey.startsWith("reporting.report.")).toBe(true);
      expect(d.descriptionKey.startsWith("reporting.report.")).toBe(true);
      expect(d.columns.length).toBeGreaterThan(0);
      for (const c of d.columns) {
        expect(c.labelKey.startsWith("reporting.col.")).toBe(true);
      }
      for (const p of d.params) {
        expect(["farmId", "lotId", "dateFrom", "dateTo"]).toContain(p.kind);
      }
    }
  });

  it("covers every module category", () => {
    const categories = new Set(REPORT_DEFINITIONS.map((d) => d.category));
    for (const c of [
      "herd",
      "performance",
      "health",
      "reproduction",
      "pasture",
      "inventory",
      "finance",
    ]) {
      expect(categories.has(c as never)).toBe(true);
    }
  });

  it("finds a report by key and returns undefined for an unknown one", () => {
    expect(findReport("finance.pl")?.category).toBe("finance");
    expect(findReport("nope.nope")).toBeUndefined();
  });
});

describe("csv serialisation", () => {
  const columns = findReport("herd.inventory")!.columns;

  it("emits the header row even with no data", () => {
    expect(reportRowsToCsv(columns, [])).toBe(columns.map((c) => c.key).join(","));
  });

  it("escapes commas, quotes and newlines, and keeps column order", () => {
    const csv = reportRowsToCsv(columns, [
      {
        visualId: "A,1",
        sex: "female",
        breedCode: 'Bran"gus',
        lifecycleStatus: "active",
        birthDate: "2022-01-01",
      },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("visualId,sex,breedCode,lifecycleStatus,birthDate");
    expect(lines[1]).toContain('"A,1"');
    expect(lines[1]).toContain('"Bran""gus"');
  });
});
