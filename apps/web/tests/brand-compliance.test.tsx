import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "../src/i18n/messages.js";
import type { Locale } from "../src/i18n/index.js";

/**
 * Static guards for the brand rules that are easy to break by accident and
 * invisible in review (docs/brand §2.3, §2.4, §3.2, §5.1).
 *
 * These read the source rather than render it: the point is to catch a new
 * screen that hard-codes a colour or ships an untranslated label, which no
 * behavioural test would notice.
 */
// vitest runs this suite with jsdom, where import.meta.url is an http URL,
// so resolve from the project root instead of the module URL.
const SRC = join(process.cwd(), "src");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const files = sources(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("brand compliance", () => {
  /** §3.2 — every colour comes from @jk/brand, never a literal. */
  it("uses no hard-coded colours outside the token package", () => {
    const offenders = files
      .filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  /**
   * §2.4 — an interactive control needs an accessible name, and in a
   * pt-BR-first product that name has to be translated. A placeholder is
   * not a name.
   */
  it("gives every input and select a translated accessible name", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!/<(input|select)\b/.test(line)) return;
        const block = lines.slice(i, i + 8).join("\n");
        const before = lines.slice(Math.max(0, i - 6), i).join("\n");
        const named = /aria-label|aria-labelledby/.test(block) || /<label/.test(before);
        if (!named) offenders.push(`${path}:${i + 1}`);
        // An accessible name must come from the catalogue, not a literal.
        const literal = /aria-label="[^"{}]+"/.exec(block);
        if (literal) offenders.push(`${path}:${i + 1} untranslated ${literal[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /** §2.3 — no hype vocabulary and no vague failure copy, in any locale. */
  it("keeps banned vocabulary out of the message catalogue", () => {
    const banned =
      /\b(revolutionar|seamless|cutting-edge|game-chang|effortless|oops)\w*/i;
    const offenders: string[] = [];
    for (const locale of Object.keys(messages) as Locale[]) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (banned.test(value)) offenders.push(`${locale}/${key}: ${value}`);
        // A bare "error"/"erro" tells a person in a corral nothing.
        // A bare failure word in any of the three languages says nothing
        // about what happened or what is still true.
        if (/^(erro|error|falha|failed|failure|fallo)\.?$/i.test(value.trim())) {
          offenders.push(`${locale}/${key}: "${value}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /** §5.1 — SAGA is a word, not an acronym, and is never sentence case. */
  it("never writes the product name as Saga or S.A.G.A.", () => {
    const offenders: string[] = [];
    for (const locale of Object.keys(messages) as Locale[]) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (/\bSaga\b|S\.A\.G\.A\./.test(value)) offenders.push(`${locale}/${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** §5.1 — the retired names appear in no user-facing string. */
  it("never surfaces a retired product name", () => {
    const offenders = files
      .filter((f) => /JK Platform|JK Software|jk\.example/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  /**
   * §2.4 — a declarative list column names itself with a catalogue key. If the
   * key is absent, `t()` falls through to the key path and the table header
   * silently reads `finance.amountCol`, which no review catches because the
   * screen still renders. Every key a RecordList names must exist.
   */
  it("resolves every list title, column and empty-state key", () => {
    const catalogue = new Set(Object.keys(messages["pt-BR"]));
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(
        /(?:titleKey|headerKey|emptyKey):\s*"([^"]+)"/g,
      )) {
        const key = match[1]!;
        if (!catalogue.has(key)) offenders.push(`${path}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** §2.4 — a message present in one locale must exist in all of them. */
  it("keeps every locale at key parity", () => {
    const reference = Object.keys(messages["pt-BR"]).sort();
    for (const locale of Object.keys(messages) as Locale[]) {
      expect(Object.keys(messages[locale]).sort(), `${locale}`).toEqual(reference);
    }
  });
});
