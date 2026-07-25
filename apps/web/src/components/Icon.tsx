/**
 * Icon set (docs/brand §3.5).
 *
 * 24px grid, 1.75px stroke, round caps and joins, no fill, geometric with at
 * most one organic curve each. Every glyph is drawn from the work — ear tag,
 * scale, syringe, gate, paddock, ledger — never a metaphor the reader has to
 * decode. Icons inherit `currentColor`.
 *
 * Icons are decoration unless given a `title`; without one they are hidden
 * from assistive technology so the adjacent label is the single announcement.
 */
export type IconName =
  "tag" | "scale" | "syringe" | "paddock" | "ledger" | "alert" | "export" | "offline";

const PATHS: Record<IconName, JSX.Element> = {
  // Ear tag: the button and the hanging panel.
  tag: (
    <>
      <circle cx="12" cy="5.5" r="2.5" />
      <path d="M7.5 11h9l1 8.5a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5Z" />
    </>
  ),
  // Scale: platform, column, readout.
  scale: (
    <>
      <path d="M4 20h16" />
      <path d="M12 20v-6" />
      <path d="M6 6h12v6H6z" />
      <path d="M9 9h6" />
    </>
  ),
  syringe: (
    <>
      <path d="M4 20l4-4" />
      <path d="M8.5 15.5l-2-2 7-7 2 2z" />
      <path d="M14 6l4-4 2 2-4 4" />
      <path d="M11 13l-2-2" />
    </>
  ),
  // Paddock: a fenced plot, not a cloud.
  paddock: (
    <>
      <path d="M3 7h18v12H3z" />
      <path d="M8 7v12M13 7v12M18 7v12" />
      <path d="M3 12h18" />
    </>
  ),
  ledger: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l9 17H3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  // Offline: the queue that has not reached the network yet.
  offline: (
    <>
      <path d="M3 8a15 15 0 0 1 18 0" />
      <path d="M6.5 12a10 10 0 0 1 11 0" />
      <path d="M12 19h.01" />
      <path d="M3 3l18 18" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  title,
}: {
  name: IconName;
  size?: number;
  title?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
