import type { MetadataRoute } from "next";

// Milestone 6: "Portal do responsável" is a PWA (spec §2). This manifest
// makes the app installable; icons are the Next.js default placeholders
// (icon.svg / apple-icon) generated below and should be replaced with real
// branding before launch.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Escolar BR — Gestão escolar",
    short_name: "Escolar BR",
    description: "Portal do responsável — parcelas, comunicados e comprovantes",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2440de",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
