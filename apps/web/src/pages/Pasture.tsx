import { RecordList } from "../components/RecordList.js";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import type { PaddockView } from "@jk/contracts-rest";

/**
 * Pasture and grazing (§21). One row per paddock, answering the question a
 * manager actually walks in with: who is standing where, and is there still
 * grass under them.
 *
 * The availability figure carries a state, not just a number — below the exit
 * floor it reads as a warning, because a paddock at 1.100 kg DM/ha is a
 * decision, not a measurement.
 */

/** kg of dry matter per hectare below which a lot should be moved off. */
const EXIT_FLOOR_KG_DM_HA = 1500;

export function Pasture(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();

  return (
    <section>
      <div className="page-head">
        <h2>{t("pasture.title")}</h2>
      </div>
      <RecordList<PaddockView>
        titleKey="pasture.paddocks"
        load={() => client.overview.paddocks()}
        rowKey={(p) => p.id}
        emptyKey="pasture.empty"
        columns={[
          { headerKey: "common.name", render: (p) => p.name },
          { headerKey: "common.farm", render: (p) => p.farmName },
          {
            headerKey: "pasture.area",
            figure: true,
            render: (p) => (p.areaHa === null ? "—" : fmt.number(p.areaHa)),
          },
          { headerKey: "pasture.type", render: (p) => td(p.pastureType) },
          {
            headerKey: "pasture.water",
            render: (p) => t(p.waterAvailable ? "common.yes" : "common.no"),
          },
          {
            headerKey: "pasture.occupant",
            render: (p) =>
              p.currentLotName === null ? (
                <span className="muted">{t("pasture.vacant")}</span>
              ) : (
                p.currentLotName
              ),
          },
          {
            headerKey: "pasture.head",
            figure: true,
            render: (p) => (p.headCount === null ? "—" : fmt.number(p.headCount)),
          },
          {
            headerKey: "pasture.condition",
            render: (p) => (p.lastCondition === null ? "—" : td(p.lastCondition)),
          },
          {
            headerKey: "pasture.availability",
            figure: true,
            render: (p) => {
              if (p.lastAvailabilityKgDmHa === null) return "—";
              const low = p.lastAvailabilityKgDmHa < EXIT_FLOOR_KG_DM_HA;
              const text = fmt.number(p.lastAvailabilityKgDmHa);
              return low ? <span className="warn">{text}</span> : text;
            },
          },
          {
            headerKey: "pasture.assessed",
            figure: true,
            render: (p) =>
              p.lastAssessedAt === null ? "—" : fmt.date(p.lastAssessedAt),
          },
        ]}
      />
    </section>
  );
}
