#!/usr/bin/env python3
"""
Generates the SAGA wordmark lockups as outlined SVG (docs/brand §3.1).

The wordmark is Archivo Expanded — the `wdth` axis of the Archivo variable
font at 125%, weight 800, tracked +0.09em. Outlining it here means the
committed lockups carry no font dependency and cannot silently fall back to a
system face, which is the failure this script exists to prevent.

This is a design-asset step, not part of the build or CI. It needs fonttools
and brotli, which the repository does not depend on:

    pip install fonttools brotli
    python3 packages/brand/scripts/emit-lockups.py

Source font: @fontsource-variable/archivo (SIL Open Font License 1.1).
"""

from __future__ import annotations

import glob
import io
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "brand" / "assets"

# docs/brand §3.2 — Ink is the type colour; Paper is the reversed cut.
INK = "#222b26"
PAPER = "#f4f6f1"

WORDMARK = "SAGA"
TRACKING_EM = 0.09  # §3.3: the wordmark is tracked +0.09em.
WEIGHT = 800
WIDTH = 125  # Archivo Expanded.

# The Bar S mark, in its own 96x96 grid (docs/brand/assets/saga-mark-*.svg).
MARK_S = "M 66 24 C 66 14 52 10 41 14 C 29 19 29 33 43 38 C 58 43 69 47 67 59 C 65 71 49 75 35 69"
MARK_BAR = "M 24 84 H 72"


def load_expanded_font() -> TTFont:
    """Decompress the woff2 and pin it to the display instance."""
    matches = glob.glob(
        str(ROOT / "node_modules/.pnpm/@fontsource-variable+archivo@*/node_modules"
            "/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2")
    )
    if not matches:
        sys.exit(
            "Archivo variable woff2 not found. Run `pnpm install` first so\n"
            "@fontsource-variable/archivo is present in node_modules."
        )
    font = TTFont(matches[0])  # fontTools decompresses woff2 via brotli.
    font.flavor = None
    return instancer.instantiateVariableFont(font, {"wght": WEIGHT, "wdth": WIDTH})


def wordmark_paths(font: TTFont, cap_height: float) -> tuple[list[str], float]:
    """Return one SVG path per glyph plus the total advance, scaled to cap_height."""
    upem = font["head"].unitsPerEm
    cap = font["OS/2"].sCapHeight if hasattr(font["OS/2"], "sCapHeight") else upem * 0.72
    scale = cap_height / cap
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    tracking = TRACKING_EM * upem

    paths: list[str] = []
    x = 0.0
    for char in WORDMARK:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(pen)
        d = pen.getCommands()
        if d:
            # Flip the y axis (font space is up, SVG is down) and place the glyph.
            paths.append(
                f'<path transform="translate({x * scale:.2f} 0) '
                f'scale({scale:.5f} {-scale:.5f})" d="{d}"/>'
            )
        x += glyph_set[name].width + tracking
    return paths, (x - tracking) * scale


def svg(width: float, height: float, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'width="{width:.0f}" height="{height:.0f}" role="img" aria-label="SAGA">\n'
        f"  <title>SAGA</title>\n{body}</svg>\n"
    )


def mark(colour: str, transform: str = "") -> str:
    t = f' transform="{transform}"' if transform else ""
    return (
        f'  <g{t} fill="none" stroke="{colour}" stroke-linecap="round" stroke-linejoin="round">\n'
        f'    <path d="{MARK_S}" stroke-width="12"/>\n'
        f'    <path d="{MARK_BAR}" stroke-width="8"/>\n'
        f"  </g>\n"
    )


def build(font: TTFont) -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # --- horizontal: mark, gap, wordmark sharing the bar's ground line ---
    cap = 50.0
    gap = 26.0
    paths, advance = wordmark_paths(font, cap)
    # The bar is the ledger line the S is written on, so the wordmark sits on
    # it too: baseline = the bar's top edge (centre 84, stroke 8). Sharing one
    # ground line is what makes mark and wordmark read as a single object.
    baseline = 80.0
    word_x = 96 + gap
    for colour, name in ((INK, "ink"), (PAPER, "paper")):
        body = mark(colour) + (
            f'  <g fill="{colour}" transform="translate({word_x} {baseline})">\n    '
            + "\n    ".join(paths)
            + "\n  </g>\n"
        )
        (OUT / f"saga-lockup-h-{name}.svg").write_text(
            svg(word_x + advance, 96, body), encoding="utf-8"
        )

    # --- stacked: mark centred above the wordmark ---
    cap_s = 34.0
    paths_s, advance_s = wordmark_paths(font, cap_s)
    total_w = max(96.0, advance_s)
    mark_x = (total_w - 96) / 2
    word_x_s = (total_w - advance_s) / 2
    # Mark's lowest ink is the bar's bottom edge (88); gap measured from there.
    baseline_s = 88 + 20 + cap_s
    for colour, name in ((INK, "ink"), (PAPER, "paper")):
        body = mark(colour, f"translate({mark_x:.2f} 0)") + (
            f'  <g fill="{colour}" transform="translate({word_x_s:.2f} {baseline_s})">\n    '
            + "\n    ".join(paths_s)
            + "\n  </g>\n"
        )
        (OUT / f"saga-lockup-v-{name}.svg").write_text(
            svg(total_w, baseline_s + 6, body), encoding="utf-8"
        )

    print(f"wrote 4 lockups to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    build(load_expanded_font())
