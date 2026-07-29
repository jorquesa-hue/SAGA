import { useI18n } from "../i18n/index.js";

/**
 * A status pill that colours itself by meaning (docs/brand §3.2 — Pasto is the
 * positive state, Hide is attention, Tag highlights something in progress).
 *
 * The console shows dozens of controlled-vocabulary states — lifecycle,
 * severity, reproduction result, work-order status — and a wall of identical
 * grey pills tells the reader nothing at a glance. This maps the raw value to a
 * tone so "active" reads calm-green, "deceased"/"high" read attention-red, and
 * "pending"/"open" read Tag, while the label itself stays localized via `td`.
 * An unmapped value falls back to a neutral pill, so a new state is never
 * mis-coloured — just quiet.
 */
export type BadgeTone = "pasto" | "hide" | "tag" | "neutral";

const TONE_BY_VALUE: Record<string, BadgeTone> = {
  // Positive / healthy / good outcome.
  active: "pasto",
  resolved: "pasto",
  good: "pasto",
  excellent: "pasto",
  live: "pasto",
  revenue: "pasto",
  completed: "pasto",
  done: "pasto",
  calved: "pasto",
  positive: "pasto",
  reconciled: "pasto",
  executed: "pasto",
  // Attention / adverse / high risk.
  deceased: "hide",
  missing: "hide",
  quarantined: "hide",
  withdrawal: "hide",
  overridden: "hide",
  high: "hide",
  critical: "hide",
  urgent: "hide",
  poor: "hide",
  loss: "hide",
  aborted: "hide",
  stillborn: "hide",
  overdue: "hide",
  failed: "hide",
  expired: "hide",
  dead_letter: "hide",
  blocked: "hide",
  prohibited: "hide",
  // In progress / needs a look / mid-scale.
  pending: "tag",
  planned: "tag",
  open: "tag",
  running: "tag",
  in_progress: "tag",
  served: "tag",
  due: "tag",
  acknowledged: "tag",
  medium: "tag",
  fair: "tag",
  quarantine: "tag",
};

export function badgeTone(value: unknown): BadgeTone {
  if (value === null || value === undefined) return "neutral";
  return TONE_BY_VALUE[String(value)] ?? "neutral";
}

export function Badge({
  value,
  tone,
  label,
}: {
  /** Raw controlled value; localized for display via `td` and used for the tone. */
  value: unknown;
  /** Override the automatic tone. */
  tone?: BadgeTone;
  /** Override the displayed text (defaults to the localized `value`). */
  label?: string;
}): JSX.Element {
  const { td } = useI18n();
  const resolved = tone ?? badgeTone(value);
  return <span className={`badge badge--${resolved}`}>{label ?? td(value)}</span>;
}
