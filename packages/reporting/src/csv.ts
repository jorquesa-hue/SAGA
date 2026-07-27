import type { ReportColumn } from "./catalog.js";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialise a report snapshot to CSV in the catalogue's column order, with the
 * column keys as the header row. Money columns stay in minor units (the header
 * names them); the console formats for display, the CSV keeps the raw figure so
 * a spreadsheet does not lose precision.
 */
export function reportRowsToCsv(
  columns: readonly ReportColumn[],
  rows: readonly Record<string, unknown>[],
): string {
  const header = columns.map((c) => c.key).join(",");
  const lines = [header];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c.key])).join(","));
  }
  return lines.join("\n");
}
