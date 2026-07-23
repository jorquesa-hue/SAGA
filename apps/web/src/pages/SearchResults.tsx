import { Link, useSearchParams } from "react-router-dom";
import type { SearchHit } from "@jk/contracts-rest";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { useAsync } from "../use-async.js";

/** Global search results (§27) grouped by entity type. */
export function SearchResults(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { loading, data, error } = useAsync(() => (q ? client.search.query(q, 15) : Promise.resolve(null)), [q]);

  const total = data ? data.animals.length + data.lots.length + data.paddocks.length + data.people.length : 0;

  return (
    <section>
      <div className="page-head">
        <h2>{t("search.title")}{q ? `: “${q}”` : ""}</h2>
      </div>
      {!q && <p className="muted">{t("search.prompt")}</p>}
      {loading && <p className="muted">{t("search.searching")}</p>}
      {error && <p className="error">{error}</p>}
      {data && total === 0 && <p className="muted">{t("search.empty")}</p>}
      {data && (
        <>
          <Group title={t("search.animals")} hits={data.animals} to={(h) => `/animals/${h.id}`} />
          <Group title={t("search.lots")} hits={data.lots} />
          <Group title={t("search.paddocks")} hits={data.paddocks} />
          <Group title={t("search.people")} hits={data.people} />
        </>
      )}
    </section>
  );
}

function Group({ title, hits, to }: { title: string; hits: SearchHit[]; to?: (h: SearchHit) => string }): JSX.Element | null {
  if (hits.length === 0) return null;
  return (
    <>
      <h3>
        {title} <span className="muted">({hits.length})</span>
      </h3>
      <ul className="cards">
        {hits.map((h) => (
          <li className="card" key={`${h.type}-${h.id}`}>
            {to ? (
              <Link to={to(h)}>
                <strong>{h.label}</strong>
              </Link>
            ) : (
              <strong>{h.label}</strong>
            )}
            {h.sublabel && <p className="muted">{h.sublabel}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
