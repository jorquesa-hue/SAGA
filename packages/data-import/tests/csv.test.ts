import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    const { headers, rows } = parseCsv("visual,sex\nBR-1,female\nBR-2,male\n");
    expect(headers).toEqual(["visual", "sex"]);
    expect(rows).toEqual([
      { visual: "BR-1", sex: "female" },
      { visual: "BR-2", sex: "male" },
    ]);
  });

  it("handles quoted fields with commas, escaped quotes, and newlines", () => {
    const csv = 'name,note\n"Prado, João","a ""great"" bull"\n"multi\nline","ok"\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]).toEqual({ name: "Prado, João", note: 'a "great" bull' });
    expect(rows[1]).toEqual({ name: "multi\nline", note: "ok" });
  });

  it("skips blank lines and tolerates no trailing newline", () => {
    const { rows } = parseCsv("a,b\n1,2\n\n3,4");
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});
