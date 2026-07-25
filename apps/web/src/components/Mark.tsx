/**
 * The SAGA mark — "Bar S" (docs/brand §3.1).
 *
 * Drawn as a brand iron: uniform stroke, round terminals, no fill, no detail
 * a hot iron would lose. The bar is not decoration — in cattle-brand
 * vocabulary it is the modifier that makes the mark specific, and it doubles
 * as the ledger line the S is written on.
 *
 * Geometry is identical to docs/brand/assets/saga-mark-bar-s-*.svg. It
 * inherits `currentColor`, so the caller decides ink or reversed.
 */
export function Mark({
  size = 24,
  title,
}: {
  size?: number;
  title?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M 66 24 C 66 14 52 10 41 14 C 29 19 29 33 43 38 C 58 43 69 47 67 59 C 65 71 49 75 35 69"
          strokeWidth="12"
        />
        <path d="M 24 84 H 72" strokeWidth="8" />
      </g>
    </svg>
  );
}
