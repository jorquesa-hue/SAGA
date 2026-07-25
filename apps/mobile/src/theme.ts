import { color, font } from "@jk/brand";

/**
 * SAGA field-app theme (docs/brand §4 "Field").
 *
 * React Native has no CSS custom properties, so the shared brand tokens are
 * projected into plain style values here. The values come from `@jk/brand` —
 * never hard-code a hex in a screen, or the field app will drift away from
 * the console.
 *
 * Field constraints drive the choices: the reader is wearing gloves, standing
 * in dust and sun glare. Type is large, targets are thumb-sized, and state is
 * carried by a labelled chip rather than colour alone.
 */
export const theme = {
  color: {
    ground: color.paper,
    surface: color.surface,
    rule: color.rule,
    text: color.ink,
    textMuted: color.slate,
    /** Signature fill. Never put text in this colour — put ink on top of it. */
    accent: color.tag,
    positive: color.pasto,
    positiveWash: color.pastoWash,
    attention: color.hide,
    attentionWash: color.hideWash,
    /** Queued-but-not-synced: the state that must never look like an error. */
    pending: color.tagText,
    pendingWash: color.tagWash,
  },
  /**
   * React Native cannot drive the variable width axis, so the field app uses
   * the standard width of Archivo rather than the expanded display cut.
   */
  fontFamily: {
    body: "Archivo",
    data: "IBM Plex Mono",
  },
  /** Larger than a desktop scale on purpose — read at arm's length, outdoors. */
  fontSize: {
    title: 24,
    body: 17,
    data: 20,
    caption: 13,
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { chip: 999, control: 8 },
  /** Minimum touch target with gloves on. */
  hitSize: 48,
} as const;

/** Re-exported so screens can reach the raw tokens without a second import. */
export { color as brandColor, font as brandFont };
