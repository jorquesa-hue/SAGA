# Data Dictionary — Phase 0

Tables in `database/migrations/0001-0004`. Every tenant-scoped table has RLS
`ENABLE` + `FORCE` with a policy comparing `tenant_id` to
`NULLIF(current_setting('app.tenant_id', true), '')::uuid` (fail-closed).

## 0001 — core tenancy & event ledger

### `tenant`

| Column           | Type          | Notes                         |
| ---------------- | ------------- | ----------------------------- |
| id               | uuid PK       | `gen_random_uuid()`           |
| name             | text NOT NULL |                               |
| default_locale   | text          | default `pt-BR`               |
| default_currency | char(3)       | default `BRL`                 |
| status           | text          | CHECK active/suspended/closed |
| created_at       | timestamptz   |                               |

RLS: visible only when `id` = active tenant.

### `farm`

| Column    | Type                    | Notes                     |
| --------- | ----------------------- | ------------------------- |
| id        | uuid PK                 |                           |
| tenant_id | uuid NOT NULL FK→tenant |                           |
| name      | text NOT NULL           | UNIQUE (tenant_id, name)  |
| timezone  | text                    | default America/Sao_Paulo |
| area_ha   | numeric(12,4)           |                           |

Composite key `(id, tenant_id)` for same-tenant FKs.

### `animal`

`id`, `tenant_id` FK, `farm_id` (FK `(farm_id, tenant_id)`), `visual_id`
(UNIQUE per tenant), `species_code`, `breed_code`, `sex` CHECK
female/male/unknown, `birth_date`, `birth_date_precision` CHECK, `lifecycle_status`
CHECK planned/active/quarantined/sold/deceased/missing/transferred, `version`,
`created_at`. Composite key `(id, tenant_id)`.

### `animal_identifier`

`id`, `tenant_id`, `animal_id` (FK `(animal_id, tenant_id)`), `identifier_type`
CHECK rfid/visual/official/legacy, `identifier_value`, `valid_from`, `valid_to`
(CHECK `> valid_from`), `assigned_by`. **Partial unique index** on
`(tenant_id, identifier_type, identifier_value) WHERE valid_to IS NULL` →
JK-DOM-003 (unique among active assignments).

### `domain_event` (append-only ledger)

`event_id` text PK (ULID), `tenant_id`, `farm_id`, `event_type`, `schema_version`
(>0), `aggregate_type`, `aggregate_id`, `aggregate_version` (>0), `occurred_at`,
`recorded_at`, `actor_type`, `actor_id`, `source_channel`, `correlation_id`,
`causation_id`, `idempotency_key`, `payload` jsonb, `metadata` jsonb.
UNIQUE `(tenant_id, aggregate_type, aggregate_id, aggregate_version)` (optimistic
concurrency) and `(tenant_id, idempotency_key)` (dedupe). Trigger
`domain_event_no_update` forbids UPDATE/DELETE (JK-DOM-006).

### `outbox_message`

`message_id` text PK, `tenant_id`, `event_id` UNIQUE FK→domain_event, `subject`,
`envelope` jsonb, `created_at`, `published_at`, `publish_attempts`, `last_error`.
Partial index on unpublished rows. `jk_worker` has scoped cross-tenant policy.

## 0002 — identity & membership

- **`user_account`** — platform-level identity: `id`, `oidc_subject` UNIQUE,
  `email` (UNIQUE lower(email)), `display_name`, `status` CHECK
  invited/active/deactivated. RLS: visible via a tenant membership; INSERT open
  (onboarding), UPDATE membership-scoped.
- **`tenant_membership`** — `tenant_id`, `user_id`, `role` CHECK (8 canonical
  roles), `status`, `valid_from/to`. Partial unique on active
  `(tenant_id, user_id, role)`.
- **`farm_membership`** — farm-scoped roles (6, no tenant_owner).
- **`audit_record`** — append-only security/admin audit (§68): `actor_*`,
  `action`, `resource_*`, `outcome` CHECK success/denied/error, `correlation_id`,
  before/after refs, `detail` jsonb. `tenant_id` nullable (platform actions).
  No-update trigger.

## 0003 — land & paddock

- **`paddock`** — `farm_id`, `name` (unique active per farm), `area_ha` (>0),
  `pasture_type`, `water_available`, `geometry geometry(MultiPolygon, 4326)`
  (GiST index), `status` active/retired.

## 0004 — worker projections

- **`processed_message`** — consumer dedupe: PK `(consumer_name, message_id)`;
  no tenant column → only the worker policy applies (fail-closed to others).
- **`projection_event_stats`** — Phase 0 read model: PK
  `(tenant_id, aggregate_type)`, `event_count`, `last_event_at`, `calculated_at`
  (§42 rebuildable projection with `calculated_at` exposure). RLS tenant policy +
  `jk_worker` full-access policy.

## Roles (`database/policies/application_roles.sql`, local/CI)

- **owner** (`jk`) — migrations, tenant onboarding; superuser locally.
- **`jk_app`** — RLS-enforced tenant-scoped access; the API's app pool.
- **`jk_worker`** — outbox/projection access only; cannot read business tables.
