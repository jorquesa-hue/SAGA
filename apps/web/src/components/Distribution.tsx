import { useI18n } from "../i18n/index.js";

/**
 * A categorical distribution (docs/brand §3.4).
 *
 * Used for the two distributions the executive dashboard actually returns —
 * herd by lifecycle status, alerts by severity — which otherwise scatter
 * across one tile per category and never show their shape.
 *
 * The rules this component exists to hold:
 *
 *  - Series colours are assigned from the validated palette in fixed order
 *    and never cycled; a category past the palette folds into the last slot
 *    rather than inventing a hue.
 *  - Every bar is directly labelled with its category and value, so identity
 *    is never carried by colour alone.
 *  - Counts are set in the mono face with tabular figures (§3.3).
 *  - Bars carry a 4px rounded data-end anchored to the baseline, and the
 *    track stays recessive.
 */
export function Distribution({
  title,
  data,
}: {
  title: string;
  /** Category key (an enum value) → count. */
  data: Record<string, number>;
}): JSX.Element | null {
  const { td, fmt } = useI18n();
  const entries = Object.entries(data).filter(([, n]) => Number.isFinite(n));
  if (entries.length === 0) return null;

  const max = Math.max(...entries.map(([, n]) => n), 1);

  return (
    <figure className="dist">
      <figcaption className="dist-title">{title}</figcaption>
      <div className="dist-rows">
        {entries.map(([key, value], index) => (
          <div className="dist-row" key={key}>
            <span className="dist-name">{td(key)}</span>
            <span className="dist-track">
              <span
                className="dist-bar"
                style={{
                  width: `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%`,
                  // Fixed order, never cycled — see §3.4.
                  background: `var(--saga-series-${Math.min(index + 1, 6)})`,
                }}
              />
            </span>
            <span className="dist-value mono">{fmt.number(value)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
