import { Link, useParams } from "react-router-dom";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";
import { Mark } from "../components/Mark.js";
import { Icon } from "../components/Icon.js";

/**
 * The traceability record (docs/brand §4.2).
 *
 * This is the brand's most persuasive artefact — the thing a buyer or auditor
 * carries away — so it is laid out as a record rather than a screen: the mark,
 * identifiers in the mono face, the history in the order it happened, and a
 * plain statement that the extract is append-only. It prints on one page.
 */
export function TraceabilityRecord(): JSX.Element {
  const { id = "" } = useParams();
  const client = useClient();
  const { t, td, fmt } = useI18n();

  const animal = useAsync(() => client.animals.get(id), [id]);
  const weights = useAsync(() => client.animals.weights(id), [id]);
  const treatments = useAsync(() => client.health.treatments(id), [id]);
  const restrictions = useAsync(() => client.health.restrictions(id), [id]);

  // One chain, in the order things happened — a record reads chronologically.
  const events: { at: unknown; text: string }[] = [
    ...(weights.data?.items ?? []).map((w) => ({
      at: w.occurredAt ?? w.occurred_at,
      text: t("record.eventWeight", {
        kg: fmt.number(w.weightKg ?? w.weight_kg),
      }),
    })),
    ...(treatments.data?.items ?? []).map((tr) => ({
      at: tr.administeredAt ?? tr.administered_at,
      text: t("record.eventTreatment", {
        product: String(tr.productName ?? tr.product_name ?? tr.treatmentType ?? "—"),
      }),
    })),
    ...(restrictions.data?.items ?? []).map((r) => ({
      at: r.validFrom ?? r.valid_from ?? r.createdAt,
      text: t("record.eventRestriction", {
        type: td(r.restrictionType ?? r.restriction_type),
        status: td(r.status),
      }),
    })),
  ]
    .filter((e) => e.at)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return (
    <section className="record-page">
      <div className="page-head no-print">
        <h2>
          <Link to={`/animals/${id}`} className="back">
            {t("record.back")}
          </Link>
        </h2>
        <button type="button" onClick={() => window.print()}>
          {t("record.print")}
        </button>
      </div>

      <article className="record">
        <header className="record-head">
          <Mark size={44} title="SAGA" />
          <div>
            <div className="record-title">{t("record.title")}</div>
            <div className="record-sub mono">
              SAGA · {t("record.issued")} {fmt.date(new Date().toISOString())}
            </div>
          </div>
        </header>

        <dl className="record-fields">
          <Field label={t("record.animal")} value={animal.data?.visualId ?? id} />
          <Field label={t("record.breed")} value={animal.data?.breedCode} />
          <Field label={t("record.sex")} value={td(animal.data?.sex)} plain />
          <Field
            label={t("record.status")}
            value={td(animal.data?.lifecycleStatus)}
            plain
          />
        </dl>

        <h3 className="record-h">
          <Icon name="ledger" size={15} />{" "}
          {t("record.history", { n: fmt.number(events.length) })}
        </h3>
        {events.length === 0 && <p className="muted">{t("record.noEvents")}</p>}
        {events.length > 0 && (
          <ol className="record-chain">
            {events.map((e, i) => (
              <li key={i}>
                <span className="mono">{fmt.date(e.at)}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        )}

        {/* §1.5 proof 01 — say plainly why this document can be trusted. */}
        <p className="record-note">{t("record.appendOnly")}</p>
      </article>
    </section>
  );
}

function Field({
  label,
  value,
  plain = false,
}: {
  label: string;
  value?: unknown;
  plain?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={plain ? undefined : "mono"}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </dd>
    </div>
  );
}
