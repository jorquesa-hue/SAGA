import { RecordList } from "../components/RecordList.js";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import type { ItemView } from "@jk/contracts-rest";

/**
 * Nutrition and inventory (§22). The balance shown here is summed from the
 * movement ledger rather than stored, so it can never disagree with the
 * history that produced it.
 *
 * Two states get emphasis because they are the two that cost money: stock at
 * or below the reorder level, and batches inside 90 days of expiry.
 */
export function Inventory(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();

  return (
    <section>
      <div className="page-head">
        <h2>{t("inventory.title")}</h2>
      </div>
      <RecordList<ItemView>
        titleKey="inventory.items"
        load={() => client.overview.items()}
        rowKey={(i) => i.id}
        emptyKey="inventory.empty"
        columns={[
          { headerKey: "common.name", render: (i) => i.name },
          { headerKey: "inventory.category", render: (i) => td(i.category) },
          {
            headerKey: "inventory.balance",
            figure: true,
            render: (i) => {
              const text = `${fmt.number(i.balance)} ${i.unit}`;
              return i.belowReorder ? <span className="warn">{text}</span> : text;
            },
          },
          {
            headerKey: "inventory.reorder",
            figure: true,
            render: (i) =>
              i.reorderLevel === null ? "—" : fmt.number(i.reorderLevel),
          },
          { headerKey: "inventory.supplier", render: (i) => i.supplier ?? "—" },
          {
            headerKey: "inventory.expiring",
            figure: true,
            render: (i) =>
              i.expiringBatches === 0 ? (
                "—"
              ) : (
                <span className="warn">{fmt.number(i.expiringBatches)}</span>
              ),
          },
          {
            headerKey: "inventory.lastMovement",
            figure: true,
            render: (i) =>
              i.lastMovementAt === null ? "—" : fmt.date(i.lastMovementAt),
          },
        ]}
      />
    </section>
  );
}
