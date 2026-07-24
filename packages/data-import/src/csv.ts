/**
 * Minimal RFC 4180-style CSV parser (zero dependencies). Handles quoted fields,
 * escaped quotes (""), embedded commas/newlines, and CRLF/LF line endings. The
 * first non-empty row is the header. Returns objects keyed by header name.
 */
export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  const records = tokenize(text);
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0]!.map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i]!;
    // Skip fully-empty lines (a single empty cell).
    if (cells.length === 1 && cells[0] === "") continue;
    const row: Record<string, string> = {};
    headers.forEach((h, c) => {
      row[h] = (cells[c] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function tokenize(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    record.push(field);
    field = "";
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the trailing field/record (file may not end with a newline).
  if (field.length > 0 || record.length > 0) pushRecord();
  return records;
}
