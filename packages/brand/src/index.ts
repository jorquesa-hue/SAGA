/**
 * SAGA brand tokens — the single source of truth for the identity in code
 * (docs/brand/README.md).
 *
 * This module is the source; `tokens.css` at the package root is GENERATED
 * from it by `pnpm --filter @jk/brand run tokens`. A unit test fails if the
 * two drift, so the web console (CSS custom properties) and the field app
 * (React Native styles) cannot disagree about what the brand is.
 *
 * The identity is light-led: Paper and Tag are the dominant surfaces and Ink
 * is a type colour that never grounds a large field (docs/brand §3.2).
 */

/** Colours whose contrast against `surface.paper` has been measured (§3.2). */
export const color = {
  /** Dominant ground, everywhere. */
  paper: "#f4f6f1",
  /** Raised surface: cards, panels, table bodies. */
  surface: "#ffffff",
  /** Recessed surface: table headers, wells, tracks. */
  surfaceSunk: "#eaede5",
  /** Hairline rules and borders. */
  rule: "#d3d9ce",

  /**
   * Ear-tag yellow — the signature. This is a FILL: it measures 1.8:1 on
   * paper and must never carry text. Put `ink` on top of it (7.5:1).
   */
  tag: "#e8b317",
  /** Pale yellow field for callouts that must not shout. */
  tagWash: "#fbf1d2",
  /** Text-safe ochre, 4.65:1 on paper — use where an ochre must read as type. */
  tagText: "#8a6a0e",

  /** Positive state — healthy, synced, cleared for sale. 4.7:1 on paper. */
  pasto: "#2e7d4f",
  /** Pale green field for positive chips and panels. Ink on it is 12.0:1. */
  pastoWash: "#e2ede4",
  /** Attention — withdrawal periods, blocks, destructive actions. 4.6:1. */
  hide: "#c0491f",
  /** Pale red field for attention chips and panels. Ink on it is 11.6:1. */
  hideWash: "#f7e2da",

  /** Type colour. Headings, body, the mark. Never a large field. 13.3:1. */
  ink: "#222b26",
  /** Secondary type, disabled state. 5.6:1 on paper. */
  slate: "#5a6560",
  /** Links. 4.9:1 on paper. */
  link: "#1f6fa8",
} as const;

/**
 * Categorical chart series (§3.4). Fixed order, never cycled — a seventh
 * series folds into "Other", facets into small multiples, or is cut.
 *
 * Validated for colour-blind separation, lightness band, chroma floor and 3:1
 * contrast against `color.paper`. Warm and green hues are interleaved with
 * blues and violets so no two neighbours sit on the red-green axis that
 * protanopia collapses — do not reorder without re-validating.
 */
export const series = [
  "#c0491f",
  "#1f6fa8",
  "#2e7d4f",
  "#7b4fa8",
  "#b07a0b",
  "#b23a6f",
] as const;

/**
 * Type families. Archivo, Archivo Expanded (the `wdth` axis of the variable
 * face) and IBM Plex Mono are the licensed faces — all OFL, so they may
 * legally embed in shipped applications.
 */
export const font = {
  body: '"Archivo Variable", "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: '"Archivo Variable", "Archivo", system-ui, sans-serif',
  data: '"IBM Plex Mono", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
} as const;

/**
 * Display type is set on the expanded width of the variable face. Applied in
 * CSS via `font-variation-settings`; React Native has no width axis, so the
 * field app falls back to the standard width.
 */
export const displayWidth = 125;

/** Wordmark tracking. It is drawn, not typed (§3.3). */
export const wordmarkTracking = "0.09em";

export type BrandColor = keyof typeof color;
