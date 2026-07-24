# Domain — Bounded Contexts (§7)

Logical contexts reflected in code modules, table ownership, API namespaces,
events, and tests, even as a modular monolith. Target packages per Appendix F.

| Context                    | Responsibility                                  | Target package                    | Status                                                      |
| -------------------------- | ----------------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| Identity and Tenancy       | organizations, farms, users, roles, policies    | `@jk/identity-tenancy`            | **implemented**                                             |
| Animal Registry            | stable animal identity and lifecycle            | `packages/animal-registry`        | schema baseline in migrations; service Phase 1              |
| Herd Operations            | lots, cohorts, movements, handling sessions     | `packages/herd-operations`        | planned (Phase 1-2)                                         |
| Reproduction and Genetics  | pedigree, mating, pregnancy, calving, selection | `packages/reproduction-genetics`  | planned (Phase 2/4)                                         |
| Health and Laboratory      | clinical events, protocols, medicine, lab       | `packages/health-laboratory`      | planned (Phase 2)                                           |
| Land and Grazing           | property, paddocks, forage, water, rotation     | `packages/land-grazing`           | paddock schema present; service Phase 3                     |
| Nutrition and Inventory    | feed plans, supplements, stock movement         | `packages/nutrition-inventory`    | planned (Phase 3)                                           |
| Finance and Commerce       | cost, revenue, budgets, sales                   | `packages/finance-commerce`       | planned (Phase 4)                                           |
| Assets and Maintenance     | scales, vehicles, equipment, calibration        | `packages/assets-maintenance`     | planned (Phase 3)                                           |
| Automation and Integration | devices, adapters, imports, connectors          | `packages/automation-integration` | planned (Phase 1+)                                          |
| Analytics and Intelligence | projections, KPIs, alerts, recommendations      | `packages/analytics-intelligence` | event-stats projection in `apps/worker`; full context later |

## Shared kernel & platform packages

| Package             | Role                                                                              | Status                                  |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| `@jk/domain-kernel` | money, measurement, identifiers, temporal, event envelope, tenant context, errors | **implemented**                         |
| `@jk/database`      | migrations runner, RLS tenant transactions, event store + outbox                  | **implemented**                         |
| `@jk/observability` | structured logging, correlation, OTel                                             | **implemented**                         |
| `@jk/testkit`       | test harness + tenant-isolation suite                                             | **implemented**                         |
| `contracts-*`       | generated REST/GraphQL/event clients                                              | contracts authored; typed clients later |

## Boundary enforcement (§35)

- Feature packages may depend on `@jk/domain-kernel` and approved shared
  technical packages only — never another feature package. Cross-context
  collaboration is via application ports or events.
- Enforced automatically by `pnpm architecture:check`
  (`scripts/validate/architecture-check.mjs`), run in CI.
