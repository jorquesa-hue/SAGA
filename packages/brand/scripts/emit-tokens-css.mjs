#!/usr/bin/env node
/**
 * Generates `tokens.css` from `src/index.ts` so the CSS custom properties the
 * web console consumes cannot drift from the TypeScript the field app
 * consumes. Run via `pnpm --filter @jk/brand run tokens`.
 *
 * `tests/unit/tokens.test.ts` regenerates and compares, so CI fails if the
 * committed CSS is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;

/** Reads the token module without a build step (it is plain literals). */
export function renderTokensCss(source) {
  const pick = (name) => {
    const block = source.match(
      new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\} as const;`),
    );
    if (!block) throw new Error(`token group '${name}' not found`);
    return [
      ...block[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*(".*?"|'.*?')\s*,/gm),
    ].map((m) => [m[1], m[2].slice(1, -1)]);
  };

  const seriesBlock = source.match(/export const series = \[([\s\S]*?)\] as const;/);
  if (!seriesBlock) throw new Error("token group 'series' not found");
  const seriesValues = [...seriesBlock[1].matchAll(/"(#[0-9a-f]{6})"/g)].map((m) => m[1]);

  const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const line = ([k, v]) => `  --saga-${kebab(k)}: ${v};`;

  return [
    "/*",
    " * GENERATED FILE — do not edit.",
    " * Source: packages/brand/src/index.ts",
    " * Regenerate: pnpm --filter @jk/brand run tokens",
    " *",
    " * Two rules these tokens encode, because they are the ones that get broken:",
    " *   1. --saga-tag is a FILL. It is 1.8:1 on paper and must never carry text;",
    " *      use --saga-tag-text where an ochre has to read as type.",
    " *   2. --saga-ink is a TYPE colour. It does not ground large fields.",
    " */",
    ":root {",
    ...pick("color").map(line),
    "",
    ...seriesValues.map((v, i) => `  --saga-series-${i + 1}: ${v};`),
    "",
    ...pick("font").map(([k, v]) => `  --saga-font-${kebab(k)}: ${v};`),
    "}",
    "",
  ].join("\n");
}

/**
 * Only act when run as a command. The drift test imports `renderTokensCss`,
 * and a top-level write would let it silently repair the very staleness it
 * exists to detect.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = readFileSync(join(root, "src/index.ts"), "utf8");
  const css = renderTokensCss(source);

  if (process.argv.includes("--check")) {
    const current = readFileSync(join(root, "tokens.css"), "utf8");
    if (current !== css) {
      console.error("tokens.css is stale — run: pnpm --filter @jk/brand run tokens");
      process.exit(1);
    }
    console.log("tokens.css is in sync with src/index.ts");
  } else {
    writeFileSync(join(root, "tokens.css"), css);
    console.log("wrote packages/brand/tokens.css");
  }
}
