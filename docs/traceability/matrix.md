# Traceability Matrix — Phase 0

Maps requirement IDs (JK-PLT-EES-001) to design area, implementing source, and
verifying tests. Status is truthful: **implemented** (code + passing tests in
this repo), **partial** (some aspects implemented, others deferred), or
**planned** (later phase per Volume XII). Machine-readable copy: `matrix.csv`.

Generated for the Phase 0 baseline (foundation and decision closure).

## Constitution & domain invariants

| Requirement                                                     | Design area                | Source                                                                                                         | Verification                                                                                               | Status                                |
| --------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| JK-CON-003 immutable history                                    | event ledger / corrections | `database/migrations/0001` (`forbid_event_mutation` trigger); `@jk/domain-kernel` envelope `supersedesEventId` | `packages/database/tests/integration/migrator.integration.test.ts` (append-only), `event-envelope.test.ts` | implemented                           |
| JK-CON-008 offline continuity                                   | mobile / sync / edge       | —                                                                                                              | —                                                                                                          | planned (Phase 1-2)                   |
| JK-DOM-001 every record has a tenant                            | schema + RLS               | migrations 0001-0004 (`tenant_id NOT NULL`, RLS FORCE)                                                         | tenant-isolation suite                                                                                     | implemented                           |
| JK-DOM-002 immutable UUID + human id                            | animal schema              | `database/migrations/0001` (`animal`, `animal_identifier`)                                                     | seed + schema tests                                                                                        | partial (registry service in Phase 1) |
| JK-DOM-003 RFID unique among active                             | animal identifiers         | `0001` `animal_identifier_active_unique` partial index                                                         | seed loads 15 active RFIDs                                                                                 | implemented (constraint)              |
| JK-DOM-004 identity independent of lot/paddock                  | schema design              | separate `animal` / (future) `lot_membership`                                                                  | —                                                                                                          | partial                               |
| JK-DOM-005 event has occurred/recorded/actor/tenant/idempotency | event envelope             | `@jk/domain-kernel/event-envelope.ts`, `@jk/database/event-store.ts`                                           | `event-envelope.test.ts`, `rls-event-store.integration.test.ts`                                            | implemented                           |
| JK-DOM-006 events not updated/deleted                           | ledger trigger             | `0001` `domain_event_no_update`                                                                                | migrator integration test (UPDATE/DELETE rejected)                                                         | implemented                           |
| JK-DOM-007 quantity value + canonical unit                      | measurement VO             | `@jk/domain-kernel/measurement.ts`                                                                             | `measurement.test.ts`                                                                                      | implemented                           |
| JK-DOM-008 money: currency + amount + basis                     | money VO                   | `@jk/domain-kernel/money.ts`                                                                                   | `money.test.ts`                                                                                            | implemented                           |
| JK-DOM-009 device obs raw preserved                             | ingestion                  | —                                                                                                              | —                                                                                                          | planned (Phase 1)                     |
| JK-DOM-010 deceased/sold stay queryable                         | lifecycle status           | `animal.lifecycle_status` CHECK                                                                                | schema                                                                                                     | partial                               |
| JK-DOM-011 withdrawal → restriction                             | health                     | —                                                                                                              | —                                                                                                          | planned (Phase 2)                     |
| JK-DOM-012 high-impact AI stays proposal                        | governed AI                | —                                                                                                              | —                                                                                                          | planned (Phase 5)                     |

## Identity, tenancy, access (§17, §66-§68)

| Requirement                                                 | Design area          | Source                                                               | Verification                                          | Status                               |
| ----------------------------------------------------------- | -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| JK-IAM-001 multi-tenant, multi-farm, farm-scoped membership | identity-tenancy     | `@jk/identity-tenancy` service + migrations 0001-0002                | `identity-service.integration.test.ts`                | implemented                          |
| JK-IAM-002 OIDC/OAuth 2.1 auth                              | API auth             | `apps/api/src/auth.ts` (jose JWT verify + dev fallback)              | `api.integration.test.ts` (401 path)                  | partial (skeleton; provider ADR-002) |
| JK-IAM-003 role + attribute authorization                   | authorization policy | `@jk/identity-tenancy/authorization.ts`                              | `authorization.test.ts`, isolation suite              | implemented                          |
| JK-IAM-004 privileged support access time-bound/audited     | admin                | —                                                                    | —                                                     | planned                              |
| JK-IAM-005 deactivate without deleting authorship           | membership lifecycle | `revokeMembership` (sets `valid_to`, never deletes)                  | `identity-service.integration.test.ts`                | implemented                          |
| JK-IAM-006 service accounts least privilege                 | DB roles             | `database/policies/application_roles.sql`, `jk_worker` scoped grants | isolation suite (worker cannot touch business tables) | implemented                          |

## Security (§65-§68)

| Requirement                                                    | Design area    | Source                                                    | Verification                                             | Status               |
| -------------------------------------------------------------- | -------------- | --------------------------------------------------------- | -------------------------------------------------------- | -------------------- |
| JK-SEC-004 server-side tenant resolution + authz before access | API + services | `apps/api/src/request-context.ts`, service `authorized()` | isolation suite, `api.integration.test.ts`               | implemented          |
| JK-SEC-005 RLS defense in depth                                | migrations     | RLS FORCE + policies (all tenant tables)                  | tenant-isolation suite                                   | implemented          |
| JK-SEC-006 no secrets in logs                                  | observability  | `@jk/observability/logger.ts` redaction                   | `observability.test.ts`                                  | implemented          |
| JK-SEC-009 tamper-evident audit for privileged actions         | audit stream   | `audit_record` (append-only trigger), service writes      | `identity-service.integration.test.ts` (denials audited) | implemented          |
| JK-SEC-001/002/007/010 TLS, encryption, file scan, CI scans    | infra / CI     | `infrastructure/`, `.github/workflows/security.yml`       | workflow (structural)                                    | partial (infra ADRs) |

## Phase 1 — Operational Identity and Weighing

| Requirement                                               | Design area        | Source                                               | Verification                               | Status                                   |
| --------------------------------------------------------- | ------------------ | ---------------------------------------------------- | ------------------------------------------ | ---------------------------------------- |
| JK-ANI-001 register manual/batch/import                   | animal registry    | `@jk/animal-registry` registerAnimal                 | `animal-registry.integration.test.ts`      | implemented (manual/batch; import later) |
| JK-ANI-002 assign visual/RFID/official/legacy             | identifiers        | `assignIdentifier`, `replaceIdentifier`              | integration test                           | implemented                              |
| JK-ANI-004 chronological event timeline                   | timeline           | `getTimeline` + `domain_event`                       | integration + API test                     | implemented                              |
| JK-ANI-008 preserve prior values on identity change       | identifier history | `replaceIdentifier` closes interval                  | integration test (history + reassign)      | implemented                              |
| JK-DOM-002 immutable UUID + human id                      | animal aggregate   | `@jk/animal-registry`, migration 0001                | integration test                           | implemented                              |
| JK-DOM-003 RFID unique among active                       | identifier index   | `animal_identifier_active_unique`                    | uniqueness conflict test                   | implemented                              |
| JK-DOM-004 identity independent of lot/paddock            | design             | animal vs temporal relations                         | replace-keeps-identity test                | implemented                              |
| JK-DOM-009 device raw payload preserved                   | observation ledger | `device_observation.raw_payload` (migration 0005)    | weighing integration test                  | implemented                              |
| JK-WGT-001 start handling session                         | herd ops           | `WeighingService.startSession`                       | weighing + API test                        | implemented                              |
| JK-WGT-002 one validation pipeline (all channels)         | pipeline           | `processObservation`                                 | weighing test; 500-animal E2E              | implemented                              |
| JK-WGT-003 unresolved/duplicate/implausible as exceptions | pipeline           | resolution_status + exception queue                  | weighing test (pending/rejected/flag)      | implemented                              |
| JK-WGT-004 raw + normalized stored separately             | observation        | `raw_value`/`unit` vs `normalized_weight_kg`         | weighing test                              | implemented                              |
| JK-WGT-006 ADG from eligible readings only                | analytics          | `computeAdg`, `animal_weight.eligible_for_analytics` | ADG test                                   | implemented                              |
| JK-WGT-008 store-and-forward idempotent replay            | ingestion          | `ingestBatch` + idem index                           | 500-animal disconnect/replay E2E           | implemented                              |
| Phase 1 exit: 500-animal session disconnect/replay        | e2e                | `devices/simulators`                                 | `handling-session-500.integration.test.ts` | implemented                              |

## Phase 2 — Health, Reproduction, and Movement

| Requirement                                              | Design area  | Source                                                 | Verification                                   | Status      |
| -------------------------------------------------------- | ------------ | ------------------------------------------------------ | ---------------------------------------------- | ----------- |
| JK-HLT-001 protocols by species/age/class/version        | health       | `@jk/health-laboratory` defineProtocol; migration 0006 | health integration test                        | implemented |
| JK-HLT-003 batch vaccination/treatment + exceptions      | health       | `batchTreatment` (savepoints)                          | health integration test                        | implemented |
| JK-HLT-004 medicine batch/dose/route/withdrawal          | health       | `treatment` table + `recordTreatment`                  | health integration test                        | implemented |
| JK-HLT-005 block sale-clear during withdrawal + override | health       | `checkSaleClear`, `overrideRestriction`                | health test (block, vet override, tech denied) | implemented |
| JK-HLT-006 clinical case open→outcome                    | health       | `openCase`/`resolveCase`, `health_case`                | health integration test                        | implemented |
| JK-DOM-011 withdrawal → restriction + due date           | health       | `animal_restriction` + restriction_started             | health integration test                        | implemented |
| JK-REP-003 record AI/TAI/natural service                 | reproduction | `@jk/reproduction-genetics` recordService              | reproduction integration test                  | implemented |
| JK-REP-004/005 pregnancy check + outcomes                | reproduction | `recordPregnancyCheck` (+ expected calving)            | reproduction integration test                  | implemented |
| JK-REP-006 calving creates/links calf + parentage        | reproduction | `recordCalving` + CalfRegistrar + `animal_parentage`   | reproduction test (calf + pedigree)            | implemented |
| JK-GEN-001 typed confidence-rated pedigree               | genetics     | `animal_parentage` (migration 0007)                    | reproduction integration test                  | implemented |
| JK-HER-001 create lot with purpose                       | herd ops     | `LotsService.createLot`; migration 0008                | lots integration test                          | implemented |
| JK-HER-002 temporal membership, one primary lot          | herd ops     | `lot_membership` partial unique + addAnimals           | lots test (one-active-lot)                     | implemented |
| JK-HER-003 batch move between paddocks                   | herd ops     | `moveToPaddock` closes prior occupation                | lots test (paddock move)                       | implemented |
| JK-HER-004 current location as projection                | herd ops     | `getAnimalLot`/`getCurrentPaddock`                     | lots integration test                          | implemented |

## Phase 2 completion + Phase 3 — Pasture, Inventory, Assets

| Requirement                                  | Design area  | Source                                      | Verification                  | Status      |
| -------------------------------------------- | ------------ | ------------------------------------------- | ----------------------------- | ----------- |
| JK-HLT-002 / JK-REP-004 due tasks & alerts   | analytics    | `@jk/analytics-intelligence` generateAlerts | analytics integration test    | implemented |
| §26 monitoring reports (nucleus, beef lot)   | analytics    | `ReportService`                             | analytics integration test    | implemented |
| JK-PAS-002 pasture assessment                | land-grazing | `@jk/land-grazing`; migration 0010          | land-grazing integration test | implemented |
| JK-PAS-004 stocking / grazing days / kg-ha   | land-grazing | `getGrazingMetrics`                         | land-grazing integration test | implemented |
| JK-INV-001 item master + batches             | inventory    | `@jk/nutrition-inventory`; migration 0011   | inventory integration test    | implemented |
| JK-INV-002 immutable ledger + balances       | inventory    | `stock_movement` (append-only)              | inventory test (immutability) | implemented |
| JK-INV-003 consumption linkage               | inventory    | `consumeStock` (animal/lot/paddock)         | inventory integration test    | implemented |
| JK-INV-005 negative-stock block + expiry     | inventory    | `consumeStock`, `getExpiringBatches`        | inventory integration test    | implemented |
| JK-AST-001 asset register                    | assets       | `@jk/assets-maintenance`; migration 0012    | assets integration test       | implemented |
| JK-AST-002 maintenance/calibration schedules | assets       | `defineSchedule`                            | assets integration test       | implemented |
| JK-AST-003 work orders                       | assets       | `createWorkOrder`/`completeWorkOrder`       | assets integration test       | implemented |
| JK-AST-004 device calibration status         | assets       | `recordCalibration`/`getCalibrationStatus`  | assets test (valid/expired)   | implemented |

## Phase 4 — Finance, Genetics, Executive Intelligence

| Requirement                                          | Design area | Source                                                      | Verification               | Status      |
| ---------------------------------------------------- | ----------- | ----------------------------------------------------------- | -------------------------- | ----------- |
| JK-DOM-008 money: currency + amount + basis          | finance     | `@jk/domain-kernel/money.ts`; migration 0013                | finance integration test   | implemented |
| JK-FIN-002 split allocation                          | finance     | `@jk/finance-commerce` (lossless allocate)                  | finance test (split)       | implemented |
| JK-FIN-003 disclosed allocation rule version         | finance     | `allocation_rule_version`                                   | finance integration test   | implemented |
| JK-FIN-004 monthly budget + variance                 | finance     | `setBudget`/`getBudgetVariance`                             | finance test (variance)    | implemented |
| JK-FIN-005 animal/lot sale + net receipt             | finance     | `recordSale`                                                | finance test (net receipt) | implemented |
| JK-FIN-006 margin + cost per dimension               | finance     | `getMarginForLot`/`getCostForTarget`                        | finance test (margin)      | implemented |
| JK-GEN-002 DEP/EBV import with provenance            | genetics    | `@jk/reproduction-genetics` GeneticsService; migration 0014 | genetics test (provenance) | implemented |
| JK-GEN-004 versioned selection index                 | genetics    | `defineSelectionIndex`                                      | genetics integration test  | implemented |
| JK-GEN-005 transparent ranking                       | genetics    | `rankAnimals` (inputs/normalization/exclusions)             | genetics test (ranking)    | implemented |
| JK-GEN-006 genetic progress by cohort                | genetics    | `geneticProgress`                                           | genetics integration test  | implemented |
| §60 Farm Intelligence Index (versioned, transparent) | analytics   | `@jk/analytics-intelligence` FarmIntelligenceService        | FII integration test       | implemented |
| §26 executive dashboard                              | analytics   | `executiveDashboard`                                        | FII integration test       | implemented |

## Reporting (§26 mandatory reports, §47 tenant-scoped reads, §59 dashboards)

| Requirement                                            | Design area | Source                                                                         | Verification                                              | Status      |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------- |
| §26 report catalogue (parameterised, per module)       | reporting   | `@jk/reporting` `catalog.ts` (8 reports across 7 categories)                   | `catalog.test.ts` (catalogue shape, every category)       | implemented |
| §26 reports projected from authoritative records       | reporting   | `@jk/reporting` report `run()` queries; `apps/api/.../reporting.routes.ts`     | `reporting.integration.test.ts` (every report previews)   | implemented |
| §47 tenant-scoped report reads                         | reporting   | `ReportingService` `withTenantTransaction` + RLS; migration 0021               | `reporting.integration.test.ts` (no cross-tenant leak)    | implemented |
| append-only report run ledger (immutable snapshots)    | reporting   | migration 0021 `report_run` + `forbid_event_mutation` trigger                  | `reporting.integration.test.ts` (UPDATE/DELETE rejected)  | implemented |
| report generation emits a domain event (outbox)        | reporting   | `reporting.report_generated.v1`; `contracts/asyncapi`, `contracts/json-schema` | `reporting.integration.test.ts` (event recorded)          | implemented |
| read-only preview vs recorded run                      | reporting   | `previewReport` (no ledger) vs `runReport`; `GET .../preview`                  | `reporting.integration.test.ts` (preview records nothing) | implemented |
| authorization: active membership required              | reporting   | `@jk/reporting` `authorization.ts`                                             | `reporting.integration.test.ts` (no-membership 403)       | implemented |
| CSV delivery of a report snapshot                      | reporting   | `csv.ts` `reportRowsToCsv`; `Reports.tsx` client-side download                 | `catalog.test.ts` (csv escaping), `reports.test.tsx`      | implemented |
| reporting web surface (catalogue, params, table, runs) | reporting   | `apps/web/src/pages/Reports.tsx`; `nav.reports`; i18n PT/EN/ES                 | `apps/web/tests/reports.test.tsx`                         | implemented |
| §3.2 status pills coloured by meaning (Pasto/Hide/Tag) | web console | `apps/web/src/components/Badge.tsx` (tone map); list screens                   | `apps/web/tests/badge.test.tsx`                           | implemented |
| list rows are a way into the record (clickable)        | web console | `apps/web/src/components/RecordList.tsx` `rowHref`; `Lots.tsx`                 | verified in browser (row click → lot detail)              | implemented |

## Architecture fitness functions (§36)

| Requirement                                   | Source                                                                                | Verification                      | Status                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- | ---------------------- |
| dependency boundaries between packages        | `scripts/validate/architecture-check.mjs`                                             | `pnpm architecture:check` (CI)    | implemented            |
| API/event schema validation                   | `scripts/validate/contracts-validate.mjs`, `contracts/`                               | `pnpm contracts:validate` (CI)    | implemented            |
| migration ordering + checksum                 | `@jk/database/migrator.ts`                                                            | migrator integration tests        | implemented            |
| tenant predicate present / cross-tenant tests | `@jk/testkit` isolation suite                                                         | `pnpm test:tenant-isolation` (CI) | implemented            |
| no secrets / prohibited licenses              | `.github/workflows/security.yml`                                                      | CI (gitleaks, dependency-review)  | implemented (workflow) |
| contract compatibility                        | `.github/workflows/contract-compatibility.yml`, `scripts/validate/openapi-compat.mjs` | CI                                | implemented (workflow) |

## Mandatory deliverables (Volume XIII)

| #                | Deliverable                                         | Path                                                              | Status                                      |
| ---------------- | --------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| 1                | Source code monorepo                                | `packages/`, `apps/`                                              | implemented (Phase 0 scope)                 |
| 3                | OpenAPI                                             | `contracts/openapi/jk-platform.yaml`                              | implemented                                 |
| 4                | GraphQL schema                                      | `contracts/graphql/schema.graphql`                                | implemented                                 |
| 5                | AsyncAPI / event schemas                            | `contracts/asyncapi/`, `contracts/json-schema/`                   | implemented                                 |
| 6                | SQL migrations                                      | `database/migrations/0001-0004`                                   | implemented                                 |
| 7                | Docker manifests                                    | `infrastructure/docker/`, `infrastructure/compose/`               | implemented (unvalidated: no docker in env) |
| 8                | Kubernetes manifests                                | `infrastructure/helm/jk-api/`                                     | implemented (unvalidated)                   |
| 9                | CI/CD pipelines                                     | `.github/workflows/`                                              | implemented (structural)                    |
| 10               | Terraform                                           | `infrastructure/terraform/`                                       | partial (provider ADR-001)                  |
| 13               | Backend services                                    | `apps/api`, `apps/worker`, `packages/*`                           | implemented (Phase 0 scope)                 |
| 16               | Automated tests                                     | package `tests/` suites                                           | implemented (147 tests)                     |
| 17               | Operational documentation                           | `docs/operations/`                                                | implemented                                 |
| 19               | Data dictionary + traceability                      | `docs/data-dictionary/`, this file                                | implemented                                 |
| 20               | Security & supply-chain evidence                    | `docs/security/threat-model.md`, `.github/workflows/security.yml` | partial                                     |
| 2,11,12,14,15,18 | diagrams(partial), web, mobile, edge, AI, user docs | —                                                                 | planned (later phases)                      |

## Console read surface and the JQ Farm demonstration seed

Added with the collection-read slice: the command surfaces existed before the
matching reads, so the console could write a treatment or a lot but not see the
ones already recorded. Every list below delegates to its own module's service —
the API composes, it never queries another context's tables.

| Requirement                                     | Design area              | Source                                                                                    | Verification                                                                         | Status      |
| ----------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------- |
| §47 collection reads for every module           | REST read surface        | `apps/api/src/routes/overview.routes.ts` (17 endpoints)                                   | `pnpm architecture:check`; endpoints exercised against the seeded tenant             | implemented |
| §20 lot state is a projection of movement facts | herd operations          | `LotsService.listLots` (head count + current paddock computed, not stored)                | `packages/herd-operations/tests`                                                     | implemented |
| §19 weighing session progress is observable     | herd operations          | `WeighingService.listSessions` / `listRecentWeights`                                      | counts derived from `device_observation`, not the stored summary                     | implemented |
| §23 active restrictions are visible before sale | health & laboratory      | `HealthService.listAllActiveRestrictions`; `apps/web/src/pages/Treatments.tsx`            | `apps/web/tests/brand-compliance.test.tsx` (key resolution)                          | implemented |
| §21 breeding station reads as one stream        | reproduction             | `ReproductionGeneticsService.listReproductionEvents` (UNION of the three fact tables)     | seeded station renders service → diagnosis → calving in order                        | implemented |
| §55 money stays in minor units to the client    | finance & commerce       | `FinanceService.listEntries` / `listSales` / `listBudgetLines`                            | `apps/web/tests/budgets.test.tsx`, `tenant-currency.test.tsx`                        | implemented |
| §21 grazing state per paddock                   | land & grazing           | `LandGrazingService.listPaddocks`; `apps/web/src/pages/Pasture.tsx`                       | occupancy and latest assessment joined per paddock                                   | implemented |
| §22 stock balance derives from the ledger       | nutrition & inventory    | `InventoryService.listItems` (balance summed from `stock_movement`)                       | balance cannot disagree with the movements that produced it                          | implemented |
| §24 calibration lapse is visible                | assets & maintenance     | `AssetsMaintenanceService.listAssets` / `listWorkOrders`; `apps/web/src/pages/Assets.tsx` | a lapsed scale keeps accepting weights and is surfaced, never silently dropped       | implemented |
| §25 breeding values comparable across animals   | genetics                 | `GeneticsService.listEvaluations` (pivoted per animal); `apps/web/src/pages/Genetics.tsx` | value shown with its percentile                                                      | implemented |
| §26 generated work names its rule               | analytics & intelligence | `AlertService.listTasks`; `apps/web/src/pages/Tasks.tsx`                                  | every task row carries `source_rule`                                                 | implemented |
| §2.4 no untranslated label reaches a screen     | brand / i18n             | `apps/web/src/components/RecordList.tsx`, `apps/web/src/i18n/`                            | `brand-compliance.test.tsx` "resolves every list title, column and empty-state key"  | implemented |
| §6 synthetic reference data, never production   | seeds                    | `scripts/bootstrap/generate-demo-seed.mjs` → `database/seeds/0002_jq_farm_demo.sql`       | deterministic generator (no clock, seeded PRNG); idempotent `ON CONFLICT DO NOTHING` | implemented |
| §27/§87 real data enters only via staged import | seeds / import           | seed header states the rule; `import_job` rows demonstrate the staged workflow            | constitution invariant 7 — no secret, credential, or personal datum in the generator | implemented |

## No orphan P0 requirement

Every P0 capability in the §16 map that Phase 0 targets (tenant/farm/user
administration; the identity/event/tenancy foundation the other P0 capabilities
build on) has implementing source and passing tests above. P0 capabilities
whose functional slice is scheduled later (animal registry, weighing, lots,
health, reproduction, offline sync, dashboards) are marked planned with their
target phase and are not claimed as done.
