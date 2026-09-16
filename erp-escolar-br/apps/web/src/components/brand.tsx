"use client";

// Single source of truth for the product's visual identity, so the mark
// on the login screen, the app header, the PWA manifest and the favicon
// can never drift apart.

import { useId } from "react";

export const BRAND = {
  name: "Escolar",
  suffix: "BR",
  full: "Escolar BR",
  tagline: "Gestão escolar — matrículas, cobrança e comunicação",
  color: "#2440de",
} as const;

/**
 * The mark: a rounded tile holding three stacked bars of decreasing
 * width — a ledger/register read at a glance, and an "E" when squinted.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // A unique gradient id per instance: the mark renders more than once at
  // a time now (sidebar + mobile topbar + mobile drawer), and a duplicate
  // SVG id resolves unpredictably — in Chromium, a fill="url(#id)" fails
  // to paint at all when the first same-id definition sits in a
  // display:none ancestor (the desktop sidebar on a mobile viewport).
  const gradientId = `ebr-g-${useId()}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={BRAND.full}
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b5ef2" />
          <stop offset="100%" stopColor="#1c2c71" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <rect x="8" y="9" width="16" height="3.2" rx="1.6" fill="#fff" />
      <rect x="8" y="14.4" width="11" height="3.2" rx="1.6" fill="#fff" opacity="0.85" />
      <rect x="8" y="19.8" width="16" height="3.2" rx="1.6" fill="#fff" opacity="0.7" />
    </svg>
  );
}

/** Mark + wordmark. `inverted` for use on the brand-coloured background. */
export function Logo({
  size = 32,
  inverted = false,
  showTagline = false,
}: {
  size?: number;
  inverted?: boolean;
  showTagline?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="leading-tight">
        <span
          className={`block text-[0.95rem] font-bold tracking-tight ${
            inverted ? "text-white" : "text-ink-900"
          }`}
        >
          {BRAND.name}
          <span className={inverted ? "text-brand-200" : "text-brand-600"}>
            {BRAND.suffix}
          </span>
        </span>
        {showTagline && (
          <span
            className={`block text-[0.7rem] ${
              inverted ? "text-brand-200" : "text-ink-500"
            }`}
          >
            {BRAND.tagline}
          </span>
        )}
      </span>
    </span>
  );
}
