import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { color, series, font } from "../../src/index.js";

const root = new URL("../..", import.meta.url).pathname;
const tokensCss = readFileSync(join(root, "tokens.css"), "utf8");

/**
 * The brand is only "executable" if the generated CSS cannot drift from the
 * TypeScript. These tests are the guard: they fail when someone edits one
 * side and forgets the other, and when a colour rule from docs/brand §3.2 is
 * violated.
 */
describe("brand tokens", () => {
  it("tokens.css is in sync with the TypeScript source", async () => {
    const { renderTokensCss } = await import("../../scripts/emit-tokens-css.mjs");
    const source = readFileSync(join(root, "src/index.ts"), "utf8");
    expect(tokensCss).toBe(renderTokensCss(source));
  });

  it("exposes every colour token as a CSS custom property", () => {
    for (const [name, value] of Object.entries(color)) {
      const prop = `--saga-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      expect(tokensCss, `${prop} missing`).toContain(`${prop}: ${value};`);
    }
  });

  it("exposes the categorical series in order, never cycled", () => {
    series.forEach((value, index) => {
      expect(tokensCss).toContain(`--saga-series-${index + 1}: ${value};`);
    });
    expect(tokensCss).not.toContain(`--saga-series-${series.length + 1}:`);
  });

  it("exposes the type families", () => {
    for (const key of Object.keys(font)) {
      expect(tokensCss).toContain(`--saga-font-${key}:`);
    }
  });

  /**
   * docs/brand §3.2: Tag is a fill at 1.8:1 on paper and must never carry
   * text. A separate text-safe ochre exists precisely so nobody is tempted.
   */
  it("keeps a text-safe ochre distinct from the signature yellow", () => {
    expect(color.tagText).not.toBe(color.tag);
    expect(contrast(color.tag, color.paper)).toBeLessThan(3);
    expect(contrast(color.tagText, color.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("clears WCAG AA for every colour that carries body text", () => {
    for (const key of ["ink", "slate", "link", "pasto", "hide", "tagText"] as const) {
      expect(contrast(color[key], color.paper), `${key} on paper`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("clears WCAG AA for ink on the signature yellow", () => {
    expect(contrast(color.ink, color.tag)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink, color.tagWash)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every chart series readable against paper", () => {
    for (const value of series) {
      expect(contrast(value, color.paper)).toBeGreaterThanOrEqual(3);
    }
  });
});

/** WCAG 2.1 relative luminance contrast ratio. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const int = Number.parseInt(hex.slice(1), 16);
  const r = channel((int >> 16) & 0xff);
  const g = channel((int >> 8) & 0xff);
  const b = channel(int & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
