// Small hand-drawn icon set for the app shell — 24x24 stroke icons, no
// external icon package. Kept tiny and single-purpose (nav + shell chrome
// only) rather than pulling in a full library for a dozen glyphs.

export type IconProps = {
  className?: string;
};

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconGrid({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.75" />
    </svg>
  );
}

export function IconGraduationCap({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5Z" />
      <path d="M6.5 11.5v4c0 1.4 2.46 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4" />
      <path d="M21 9.5v5" />
    </svg>
  );
}

export function IconClipboardCheck({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9 4.5V3.75A1.75 1.75 0 0 1 10.75 2h2.5A1.75 1.75 0 0 1 15 3.75V4.5" />
      <path d="M9 12.5l2 2 4-4.5" />
    </svg>
  );
}

export function IconWallet({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
      <path d="M3.5 9.5h16" />
      <circle cx="15.5" cy="14" r="1.25" />
    </svg>
  );
}

export function IconMegaphone({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 9.5v5h3l6 3.5V6l-6 3.5h-3Z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
      <path d="M6.5 14.5 7 18" />
    </svg>
  );
}

export function IconHome({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v8.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V10" />
      <path d="M10 20v-5.5h4V20" />
    </svg>
  );
}

export function IconBarChart({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20V9.5" />
      <path d="M12 20V4" />
      <path d="M20 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function IconBuilding({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5" y="3.5" width="10" height="17" rx="1.5" />
      <path d="M15 9h4v10.5a1 1 0 0 1-1 1h-3" />
      <path d="M8 7.5h.01M11.5 7.5h.01M8 11h.01M11.5 11h.01M8 14.5h.01M11.5 14.5h.01" />
    </svg>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5c0-3 2.46-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15.5 5.75a3 3 0 0 1 0 5.85" />
      <path d="M15.5 14.5c2.6.3 4.5 2.1 4.5 5" />
    </svg>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
    </svg>
  );
}

export function IconX({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
    </svg>
  );
}

export function IconLogOut({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h3.5" />
      <path d="M15.5 16.5 20 12l-4.5-4.5" />
      <path d="M20 12H9.5" />
    </svg>
  );
}

export function IconCheckShield({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 19 6.5v5c0 5-3 8-7 9-4-1-7-4-7-9v-5l7-3Z" />
      <path d="M9 12l2 2 4-4.5" />
    </svg>
  );
}
