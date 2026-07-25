import { RecordList } from "../components/RecordList.js";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { humanizeKey } from "../i18n/labels.js";
import type { TaskView } from "@jk/contracts-rest";

/**
 * Generated work (§26). Each task shows the rule that produced it: an operator
 * who disagrees with the work needs to see what asked for it, and a rule
 * nobody can name is a rule nobody can fix.
 */
export function Tasks(): JSX.Element {
  const client = useClient();
  const { t, td, fmt } = useI18n();

  /** `health.annual_booster` → a translated label, or a readable fallback. */
  const rule = (key: string): string => {
    const exact = t(`tasks.rule.${key}`);
    return exact === `tasks.rule.${key}` ? humanizeKey(key) : exact;
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("tasks.title")}</h2>
      </div>
      <RecordList<TaskView>
        titleKey="tasks.queue"
        load={() => client.overview.tasks()}
        rowKey={(k) => k.id}
        emptyKey="tasks.empty"
        columns={[
          { headerKey: "tasks.type", render: (k) => td(k.taskType) },
          { headerKey: "tasks.rule", render: (k) => rule(k.sourceRule) },
          {
            headerKey: "tasks.subject",
            render: (k) =>
              k.animalVisualId ? (
                <span className="mono">{k.animalVisualId}</span>
              ) : (
                (k.lotName ?? "—")
              ),
          },
          {
            headerKey: "tasks.due",
            figure: true,
            render: (k) => {
              if (k.dueAt === null) return "—";
              const text = fmt.date(k.dueAt);
              return k.status === "overdue" ? (
                <span className="error-text">{text}</span>
              ) : (
                text
              );
            },
          },
          {
            headerKey: "common.status",
            render: (k) => <span className="badge">{td(k.status)}</span>,
          },
        ]}
      />
    </section>
  );
}
