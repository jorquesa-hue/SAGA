import { RecordList } from "../components/RecordList.js";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import type { AssetView, WorkOrderView } from "@jk/contracts-rest";

/**
 * Assets and maintenance (§24). A scale whose calibration has lapsed keeps
 * accepting weights — the platform does not silently drop data — so the lapse
 * has to be visible here, or nobody learns of it until the figures are wrong.
 */
export function Assets(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();

  return (
    <section>
      <div className="page-head">
        <h2>{t("assets.title")}</h2>
      </div>

      <RecordList<AssetView>
        titleKey="assets.registry"
        load={() => client.overview.assets()}
        rowKey={(a) => a.id}
        emptyKey="assets.empty"
        columns={[
          { headerKey: "common.name", render: (a) => a.name },
          { headerKey: "assets.type", render: (a) => td(a.assetType) },
          { headerKey: "assets.location", render: (a) => a.location ?? "—" },
          {
            headerKey: "common.status",
            render: (a) => <span className={`badge`}>{td(a.status)}</span>,
          },
          {
            headerKey: "assets.calibration",
            figure: true,
            render: (a) => {
              if (a.calibrationValidUntil === null) return "—";
              const text = fmt.date(a.calibrationValidUntil);
              return a.calibrationOverdue ? (
                <span className="error-text">{text}</span>
              ) : (
                text
              );
            },
          },
          {
            headerKey: "assets.nextMaintenance",
            figure: true,
            render: (a) =>
              a.nextMaintenanceDueAt === null
                ? "—"
                : fmt.date(a.nextMaintenanceDueAt),
          },
          {
            headerKey: "assets.openWork",
            figure: true,
            render: (a) =>
              a.openWorkOrders === 0 ? "—" : fmt.number(a.openWorkOrders),
          },
        ]}
      />

      <RecordList<WorkOrderView>
        titleKey="assets.workOrders"
        load={() => client.overview.workOrders()}
        rowKey={(w) => w.id}
        emptyKey="assets.noWorkOrders"
        columns={[
          { headerKey: "assets.asset", render: (w) => w.assetName },
          {
            headerKey: "assets.priority",
            render: (w) => (
              <span className={`badge risk-${w.priority}`}>{td(w.priority)}</span>
            ),
          },
          { headerKey: "common.description", render: (w) => w.description },
          { headerKey: "common.status", render: (w) => td(w.status) },
          {
            headerKey: "assets.downtime",
            figure: true,
            render: (w) =>
              w.downtimeHours === null ? "—" : fmt.number(w.downtimeHours),
          },
          {
            headerKey: "assets.cost",
            figure: true,
            render: (w) => {
              const total = (w.laborCost ?? 0) + (w.partsCost ?? 0);
              return total === 0 ? "—" : fmt.currency(total);
            },
          },
          {
            headerKey: "assets.opened",
            figure: true,
            render: (w) => fmt.date(w.openedAt),
          },
        ]}
      />
    </section>
  );
}
