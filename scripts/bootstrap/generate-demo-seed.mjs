#!/usr/bin/env node
/**
 * Generates database/seeds/0002_jq_farm_demo.sql — the "JQ Farm" demonstration
 * tenant, a second synthetic farm that exercises EVERY module so the console
 * has something to show on every screen.
 *
 * SYNTHETIC DATA ONLY (constitution invariant 7, spec §27/§87). Nothing here
 * comes from a real herd, a real ledger, or a real person. The setting is
 * inspired by a beef/genetic-nucleus operation in the Serra da Bocaina
 * foothills near Cunha, São Paulo — the place names, breeds, protocols, and
 * price levels are plausible for that region, and every individual record is
 * invented. Emails use the RFC 2606 reserved domain example.com and can never
 * deliver. No secret or credential appears in the output.
 *
 * DETERMINISM. The generator has no clock and no entropy source: dates are
 * offsets from a fixed ANCHOR and every "random" choice comes from a seeded
 * PRNG. Running it twice produces a byte-identical file, so the seed can be
 * regenerated in review and diffed. Re-running the SQL is idempotent — every
 * statement is ON CONFLICT DO NOTHING and domain_event stays append-only.
 *
 * Usage: node scripts/bootstrap/generate-demo-seed.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "database/seeds/0002_jq_farm_demo.sql");

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and reproducible across Node versions. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x5a6a4741); // "SAGA"

const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const chance = (p) => rand() < p;

/**
 * "Now" for the dataset. A literal, not Date.now(): a seed whose contents
 * shift with the wall clock cannot be diffed or reasoned about.
 */
const ANCHOR = Date.UTC(2026, 6, 20, 15, 0, 0); // 2026-07-20T12:00:00-03:00
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, "0");

/**
 * Civil date in America/Sao_Paulo (UTC-03:00, no DST since 2019) `days` before
 * the anchor. Everything downstream is built from civil dates so the seed reads
 * the way the farm would say it, not the way UTC would.
 */
function civil(days) {
  return new Date(ANCHOR - days * DAY - 3 * 3600000);
}
/** Timestamp `days` before the anchor at the given local wall-clock time. */
function ts(days, hour = 9, minute = 0) {
  const d = civil(days);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(hour)}:${pad(minute)}:00-03:00`
  );
}
/** Date-only value `days` before the anchor. */
function day(days) {
  return civil(days).toISOString().slice(0, 10);
}
/** First day of the month `n` months before the anchor month. */
function monthStart(n) {
  const d = new Date(ANCHOR);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1))
    .toISOString()
    .slice(0, 10);
}

// UUID namespaces. The leading byte identifies the entity type so a stray id
// in a log is immediately traceable to its table.
const NS = {
  tenant: "10",
  farm: "11",
  user: "12",
  tenantMembership: "13",
  farmMembership: "14",
  paddock: "15",
  animal: "16",
  identifier: "17",
  lot: "18",
  lotMembership: "19",
  occupation: "1a",
  weight: "1b",
  session: "1c",
  observation: "1d",
  protocol: "1e",
  treatment: "1f",
  restriction: "20",
  healthCase: "21",
  service: "22",
  pregnancy: "23",
  calving: "24",
  assessment: "25",
  item: "26",
  batch: "27",
  stock: "28",
  asset: "29",
  maintenance: "2a",
  workOrder: "2b",
  entry: "2c",
  allocation: "2d",
  sale: "2e",
  budget: "2f",
  genetic: "30",
  index: "31",
  task: "32",
  alert: "33",
  recommendation: "34",
  aiAudit: "35",
  webhook: "36",
  connector: "37",
  exportJob: "38",
  importJob: "39",
  importRow: "3a",
  parentage: "3b",
  delivery: "3c",
  attempt: "3d",
  accessLog: "3e",
  correlation: "3f",
};

function uuid(ns, n) {
  return `${ns}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// Event ids are ULID-shaped (26 Crockford-base32 chars) and monotonic, matching
// what the runtime generates — but derived from a counter so they stay stable.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let eventCounter = 0;
function nextEventId() {
  eventCounter += 1;
  let n = eventCounter;
  let tail = "";
  for (let i = 0; i < 12; i += 1) {
    tail = B32[n % 32] + tail;
    n = Math.floor(n / 32);
  }
  return `01JQFARM0000${tail}`;
}
let messageCounter = 0;
function nextMessageId() {
  messageCounter += 1;
  let n = messageCounter;
  let tail = "";
  for (let i = 0; i < 12; i += 1) {
    tail = B32[n % 32] + tail;
    n = Math.floor(n / 32);
  }
  return `01JQMSG00000${tail}`;
}

// ---------------------------------------------------------------------------
// SQL emission
// ---------------------------------------------------------------------------

const out = [];
const emit = (line) => out.push(line);

function q(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Raw) return value.sql;
  return `'${String(value).replace(/'/g, "''")}'`;
}
class Raw {
  constructor(sql) {
    this.sql = sql;
  }
}
const raw = (sql) => new Raw(sql);
const json = (obj) => raw(`'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`);
const arr = (values) => raw(`ARRAY[${values.map((v) => q(v)).join(", ")}]::text[]`);

/**
 * Emits one INSERT with all rows batched. Chunked so no single statement grows
 * past what a reviewer or a psql buffer can comfortably handle.
 */
function insert(table, columns, rows, comment) {
  if (rows.length === 0) return;
  if (comment) emit(`\n-- ${comment}`);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    emit(`INSERT INTO ${table} (${columns.join(", ")}) VALUES`);
    chunk.forEach((row, idx) => {
      const values = columns.map((c) => q(row[c])).join(", ");
      emit(`  (${values})${idx === chunk.length - 1 ? "" : ","}`);
    });
    emit("ON CONFLICT DO NOTHING;");
  }
}

// Collected across the whole build and emitted at the end, because the ledger
// is written last in dependency order.
const events = [];
const outbox = [];
const aggregateVersion = new Map();

/**
 * Appends a domain event, mirroring what packages/database appendEvent writes
 * inside the same transaction as the state change. `publish` also queues the
 * outbox row a relay would pick up.
 */
function appendEvent({
  eventType,
  aggregateType,
  aggregateId,
  farmId,
  occurredAt,
  actorId,
  actorType = "user",
  sourceChannel = "web",
  payload,
  publish = false,
  correlationId = uuid(NS.correlation, 1),
}) {
  const key = `${aggregateType}:${aggregateId}`;
  const version = (aggregateVersion.get(key) ?? 0) + 1;
  aggregateVersion.set(key, version);
  const eventId = nextEventId();
  events.push({
    event_id: eventId,
    tenant_id: TENANT,
    farm_id: farmId,
    event_type: eventType,
    schema_version: 1,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: version,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    actor_type: actorType,
    actor_id: actorId,
    source_channel: sourceChannel,
    correlation_id: correlationId,
    causation_id: null,
    idempotency_key: `jq-${eventId}`,
    payload: json(payload),
    metadata: json({
      locale: "pt-BR",
      qualityFlags: ["synthetic_seed"],
      supersedesEventId: null,
    }),
  });
  if (publish) {
    outbox.push({
      message_id: nextMessageId(),
      tenant_id: TENANT,
      event_id: eventId,
      subject: `saga.demo.a1.${aggregateType}.${aggregateType}.${eventType
        .split(".")[1]
        .replace(/_/g, "-")
        .replace(/\.v\d+$/, "")}.v1`,
      envelope: json({
        eventId,
        eventType,
        schemaVersion: 1,
        tenantId: TENANT,
        farmId,
        aggregateType,
        aggregateId,
        aggregateVersion: version,
        occurredAt,
        recordedAt: occurredAt,
        actor: { type: actorType, id: actorId, display: "JQ Farm demo seed" },
        source: { channel: sourceChannel, deviceId: null, appVersion: null },
        correlationId,
        causationId: null,
        idempotencyKey: `jq-${eventId}`,
        payload,
        metadata: {
          locale: "pt-BR",
          qualityFlags: ["synthetic_seed"],
          supersedesEventId: null,
        },
      }),
      created_at: occurredAt,
      published_at: occurredAt,
      publish_attempts: 1,
      last_error: null,
    });
  }
  return eventId;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const TENANT = uuid(NS.tenant, 1);

emit(`-- 0002_jq_farm_demo.sql
--
-- GENERATED FILE — do not edit by hand.
-- Source: scripts/bootstrap/generate-demo-seed.mjs (pnpm db:seed:generate).
--
-- "JQ Farm": a demonstration tenant that carries data in every module, so the
-- console has something real to show on every screen — herd, weighing,
-- health, reproduction, pasture, inventory, assets, finance, genetics, tasks,
-- alerts, governed AI, integrations, exports, and staged imports.
--
-- SYNTHETIC DATA ONLY (constitution invariant 7; spec §27, §87). The setting
-- is inspired by a beef and Brangus genetic-nucleus operation in the Serra da
-- Bocaina foothills near Cunha, São Paulo. Region, breeds, protocols and price
-- levels are plausible; every individual record is invented. Emails use the
-- RFC 2606 reserved domain example.com and can never deliver. No secret,
-- credential, or personal datum appears here. Real herd, land, and people data
-- enters the platform only through the staged import workflow (§27).
--
-- Determinism: all ids are fixed literals, all timestamps are offsets from the
-- fixed anchor ${day(0)}, and the generator uses a seeded PRNG. Idempotent:
-- every statement is ON CONFLICT DO NOTHING, and the append-only ledger is
-- protected by trigger regardless.
--
-- Tenant id: ${TENANT}
`);

// ---------------------------------------------------------------------------
// Tenant, farms, people
// ---------------------------------------------------------------------------

insert(
  "tenant",
  ["id", "name", "default_locale", "default_currency", "status", "created_at"],
  [
    {
      id: TENANT,
      name: "JQ Farm",
      default_locale: "pt-BR",
      default_currency: "BRL",
      status: "active",
      created_at: ts(900),
    },
  ],
  "Tenant",
);

const FARMS = [
  {
    id: uuid(NS.farm, 1),
    name: "Sede Lagoinha",
    area: 312.4,
    lon: -44.9578,
    lat: -23.0742,
  },
  {
    id: uuid(NS.farm, 2),
    name: "Retiro Paraitinga",
    area: 148.7,
    lon: -45.0164,
    lat: -23.1188,
  },
];
const F1 = FARMS[0].id;
const F2 = FARMS[1].id;

insert(
  "farm",
  ["id", "tenant_id", "name", "timezone", "area_ha", "created_at"],
  FARMS.map((f) => ({
    id: f.id,
    tenant_id: TENANT,
    name: f.name,
    timezone: "America/Sao_Paulo",
    area_ha: f.area,
    created_at: ts(900),
  })),
  "Farms: the home block on the Paraitinga headwaters plus a leased retiro.",
);

const USERS = [
  ["Joaquim Queiroz Andrade", "proprietario", "tenant_owner", null],
  ["Marina Salgado Vieira", "gerente", "farm_manager", "farm_manager"],
  ["Douglas Prestes Amaral", "capataz", "technician", "technician"],
  ["Helena Bicudo Rangel", "veterinaria", "veterinarian", "veterinarian"],
  [
    "Tarcísio Menendes Alves",
    "melhoramento",
    "genetics_specialist",
    "genetics_specialist",
  ],
  ["Cláudia Ferrarini Lopes", "financeiro", "finance_user", "finance_user"],
  ["Sérgio Pontes Vasques", "auditoria", "auditor", "auditor"],
];
const USER_ID = {};
USERS.forEach(([, slug], i) => {
  USER_ID[slug] = uuid(NS.user, i + 1);
});
const OWNER = USER_ID.proprietario;
const MANAGER = USER_ID.gerente;
const TECH = USER_ID.capataz;
const VET = USER_ID.veterinaria;
const GENETICS = USER_ID.melhoramento;
const FINANCE = USER_ID.financeiro;

insert(
  "user_account",
  ["id", "oidc_subject", "email", "display_name", "status", "created_at", "updated_at"],
  USERS.map(([name, slug], i) => ({
    id: uuid(NS.user, i + 1),
    // Synthetic subject prefix. Real subjects are minted by the identity
    // provider on first login and are never seeded.
    oidc_subject: `seed|jq-${slug}`,
    // Prefixed so the address stays unique against the reference-farm seed,
    // which uses the same role words. lower(email) is uniquely indexed.
    email: `jq-${slug}@example.com`,
    display_name: name,
    status: "active",
    created_at: ts(900),
    updated_at: ts(900),
  })),
  "People. Emails are RFC 2606 reserved — they can never deliver.",
);

insert(
  "tenant_membership",
  ["id", "tenant_id", "user_id", "role", "status", "valid_from", "created_at"],
  USERS.map(([, , tenantRole], i) => ({
    id: uuid(NS.tenantMembership, i + 1),
    tenant_id: TENANT,
    user_id: uuid(NS.user, i + 1),
    role: tenantRole,
    status: "active",
    valid_from: ts(900),
    created_at: ts(900),
  })),
  "Tenant memberships — one per role in the tenant-scoped role set (§17).",
);

const farmMemberships = [];
USERS.forEach(([, , , farmRole], i) => {
  if (!farmRole) return; // tenant_owner is tenant-level, not a farm role
  for (const farm of FARMS) {
    farmMemberships.push({
      id: uuid(NS.farmMembership, farmMemberships.length + 1),
      tenant_id: TENANT,
      farm_id: farm.id,
      user_id: uuid(NS.user, i + 1),
      role: farmRole,
      valid_from: ts(900),
      created_at: ts(900),
    });
  }
});
insert(
  "farm_membership",
  ["id", "tenant_id", "farm_id", "user_id", "role", "valid_from", "created_at"],
  farmMemberships,
  "Farm-scoped memberships on both blocks.",
);

// ---------------------------------------------------------------------------
// Paddocks
// ---------------------------------------------------------------------------

const PASTURES = [
  "braquiaria_brizantha",
  "braquiaria_decumbens",
  "panicum_mombaca",
  "panicum_tanzania",
  "capim_nativo",
];

const PADDOCK_NAMES_F1 = [
  "Lagoinha do Meio",
  "Capão da Sede",
  "Grota Funda",
  "Beira do Paraitinga",
  "Chapadão",
  "Vargem Grande",
  "Curral Novo",
  "Pau d'Alho",
  "Bebedouro",
  "Cerca do Fundo",
  "Mangueirão",
  "Costão da Serra",
  "Retiro Velho",
  "Água Limpa",
  "Ponte de Pedra",
  "Cafundó",
  "Aroeira",
  "Baixada do Sapé",
];
const PADDOCK_NAMES_F2 = [
  "Paraitinga Alto",
  "Taboão",
  "Fazendinha",
  "Alto do Cruzeiro",
  "Ribeirão Claro",
  "Braço do Rio",
  "Sesmaria",
  "Boa Vista",
];

const paddocks = [];
function addPaddocks(farm, names, startIndex) {
  names.forEach((name, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const lon = farm.lon + col * 0.0075;
    const lat = farm.lat + row * 0.0068;
    const w = 0.0068;
    const h = 0.0061;
    const area = Number(between(6.5, 21.5).toFixed(2));
    paddocks.push({
      id: uuid(NS.paddock, startIndex + i + 1),
      tenant_id: TENANT,
      farm_id: farm.id,
      name,
      area_ha: area,
      pasture_type: PASTURES[i % PASTURES.length],
      water_available: chance(0.68),
      geometry: raw(
        `ST_GeomFromText('MULTIPOLYGON(((${lon.toFixed(4)} ${lat.toFixed(4)}, ` +
          `${(lon + w).toFixed(4)} ${lat.toFixed(4)}, ` +
          `${(lon + w).toFixed(4)} ${(lat + h).toFixed(4)}, ` +
          `${lon.toFixed(4)} ${(lat + h).toFixed(4)}, ` +
          `${lon.toFixed(4)} ${lat.toFixed(4)})))', 4326)`,
      ),
      status: "active",
      created_at: ts(900),
    });
  });
}
addPaddocks(FARMS[0], PADDOCK_NAMES_F1, 0);
addPaddocks(FARMS[1], PADDOCK_NAMES_F2, 100);

insert(
  "paddock",
  [
    "id",
    "tenant_id",
    "farm_id",
    "name",
    "area_ha",
    "pasture_type",
    "water_available",
    "geometry",
    "status",
    "created_at",
  ],
  paddocks,
  "Paddocks. Geometries are synthetic squares laid on a grid near Cunha/SP\n-- (WGS84, SRID 4326) — they mark position and shape, not a real boundary.",
);

const paddocksF1 = paddocks.filter((p) => p.farm_id === F1);
const paddocksF2 = paddocks.filter((p) => p.farm_id === F2);

// ---------------------------------------------------------------------------
// Herd
// ---------------------------------------------------------------------------

/**
 * Brody growth: W(t) = A(1 - b·e^(-k·t)), b fixed by the birth weight. Mature
 * size A and rate k differ by sex and destination, which is what makes the
 * weight series on the animal page look like an animal rather than a ramp.
 */
function brody(ageDays, mature, k, birthWeight) {
  const b = 1 - birthWeight / mature;
  return mature * (1 - b * Math.exp(-k * Math.max(ageDays, 0)));
}

const GROUPS = [
  {
    key: "touro",
    n: 4,
    sex: "male",
    from: 2600,
    to: 1800,
    status: "active",
    mature: 880,
    k: 0.0016,
  },
  {
    key: "matriz",
    n: 58,
    sex: "female",
    from: 3000,
    to: 1500,
    status: "active",
    mature: 480,
    k: 0.0019,
  },
  {
    key: "novilha",
    n: 30,
    sex: "female",
    from: 1150,
    to: 780,
    status: "active",
    mature: 470,
    k: 0.0019,
  },
  {
    key: "garrote",
    n: 34,
    sex: "male",
    from: 900,
    to: 640,
    status: "active",
    mature: 660,
    k: 0.0016,
  },
  {
    key: "bezerra",
    n: 26,
    sex: "female",
    from: 330,
    to: 180,
    status: "active",
    mature: 470,
    k: 0.0019,
  },
  {
    key: "bezerro",
    n: 24,
    sex: "male",
    from: 330,
    to: 180,
    status: "active",
    mature: 660,
    k: 0.0016,
  },
  {
    key: "vendido",
    n: 16,
    sex: "male",
    from: 1100,
    to: 850,
    status: "sold",
    mature: 660,
    k: 0.0016,
  },
  {
    key: "quarentena",
    n: 3,
    sex: "female",
    from: 800,
    to: 700,
    status: "quarantined",
    mature: 470,
    k: 0.0019,
  },
  {
    key: "obito",
    n: 2,
    sex: "female",
    from: 1400,
    to: 1000,
    status: "deceased",
    mature: 470,
    k: 0.0019,
  },
  {
    key: "sumido",
    n: 1,
    sex: "male",
    from: 900,
    to: 800,
    status: "missing",
    mature: 660,
    k: 0.0016,
  },
  {
    key: "transferido",
    n: 2,
    sex: "female",
    from: 1300,
    to: 1000,
    status: "transferred",
    mature: 470,
    k: 0.0019,
  },
];

const animals = [];
let animalSeq = 0;
for (const group of GROUPS) {
  for (let i = 0; i < group.n; i += 1) {
    animalSeq += 1;
    const ageAtAnchor = Math.round(between(group.to, group.from));
    // Birth-date precision varies: bought-in animals rarely have an exact date.
    const precision = chance(0.72)
      ? "exact"
      : chance(0.6)
        ? "estimated_month"
        : "estimated_year";
    const farmId =
      group.key === "vendido" || group.key === "garrote"
        ? chance(0.55)
          ? F2
          : F1
        : group.key === "novilha"
          ? chance(0.35)
            ? F2
            : F1
          : F1;
    animals.push({
      id: uuid(NS.animal, animalSeq),
      tenant_id: TENANT,
      farm_id: farmId,
      visual_id: `JQ-${String(animalSeq).padStart(4, "0")}`,
      species_code: "BOVINE",
      breed_code: "BRANGUS",
      sex: group.sex,
      birth_date:
        precision === "estimated_year"
          ? `${day(ageAtAnchor).slice(0, 4)}-01-01`
          : precision === "estimated_month"
            ? `${day(ageAtAnchor).slice(0, 7)}-01`
            : day(ageAtAnchor),
      birth_date_precision: precision,
      lifecycle_status: group.status,
      version: 0, // set from the ledger below
      created_at: ts(Math.min(ageAtAnchor, 880)),
      // Generator-only fields, stripped before emission.
      _group: group.key,
      _age: ageAtAnchor,
      _mature: group.mature,
      _k: group.k,
      _birthWeight: Number(between(28, 39).toFixed(1)),
      _scale: Number(between(0.9, 1.11).toFixed(3)),
    });
  }
}

const ANIMAL_COLUMNS = [
  "id",
  "tenant_id",
  "farm_id",
  "visual_id",
  "species_code",
  "breed_code",
  "sex",
  "birth_date",
  "birth_date_precision",
  "lifecycle_status",
  "version",
  "created_at",
];

const byGroup = (key) => animals.filter((a) => a._group === key);
const activeHerd = animals.filter((a) => a.lifecycle_status === "active");

/** Live weight of an animal at a given number of days before the anchor. */
function weightAt(animal, daysBefore) {
  const age = animal._age - daysBefore;
  if (age < 0) return null;
  const base = brody(age, animal._mature, animal._k, animal._birthWeight);
  // The dry season (Jun–Sep in the Vale do Paraíba) flattens or reverses gain.
  const month = new Date(ANCHOR - daysBefore * DAY).getUTCMonth();
  const dry = month >= 5 && month <= 8 ? between(-0.045, -0.01) : between(0, 0.02);
  return Number((base * animal._scale * (1 + dry)).toFixed(1));
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

const LOTS = [
  {
    key: "nucleo",
    name: "Núcleo Genético Brangus 2026",
    purpose: "genetic_nucleus",
    target: "IATF novembro — 85% prenhez",
    farm: F1,
    responsible: GENETICS,
    groups: ["matriz"],
  },
  {
    key: "touros",
    name: "Touros em Serviço",
    purpose: "other",
    target: "avaliação andrológica anual",
    farm: F1,
    responsible: GENETICS,
    groups: ["touro"],
  },
  {
    key: "recria",
    name: "Recria Fêmeas 2024/2025",
    purpose: "rearing",
    target: "330 kg à cobertura",
    farm: F1,
    responsible: MANAGER,
    groups: ["novilha"],
  },
  {
    key: "engorda",
    name: "Engorda Safra 2025",
    purpose: "beef",
    target: "18@ de carcaça",
    farm: F2,
    responsible: MANAGER,
    groups: ["garrote"],
  },
  {
    key: "cria",
    name: "Cria — Bezerrada 2025/2026",
    purpose: "rearing",
    target: "desmama aos 210 dias",
    farm: F1,
    responsible: TECH,
    groups: ["bezerra", "bezerro"],
  },
  {
    key: "quarentena",
    name: "Quarentena de Entrada",
    purpose: "quarantine",
    target: "21 dias de observação",
    farm: F1,
    responsible: VET,
    groups: ["quarentena"],
  },
  {
    key: "vendido",
    name: "Boiada Vendida — Safra 2025",
    purpose: "beef",
    target: "encerrado",
    farm: F2,
    responsible: MANAGER,
    groups: ["vendido"],
    closed: true,
  },
];

const lotRows = [];
const lotMemberships = [];
LOTS.forEach((lot, i) => {
  lot.id = uuid(NS.lot, i + 1);
  lotRows.push({
    id: lot.id,
    tenant_id: TENANT,
    farm_id: lot.farm,
    name: lot.name,
    purpose: lot.purpose,
    target: lot.target,
    responsible_id: lot.responsible,
    status: lot.closed ? "closed" : "open",
    started_at: ts(lot.closed ? 420 : intBetween(200, 380)),
    ended_at: lot.closed ? ts(52) : null,
    created_at: ts(lot.closed ? 420 : 380),
  });
  const members = lot.groups.flatMap(byGroup);
  lot.members = members;
  for (const animal of members) {
    lotMemberships.push({
      id: uuid(NS.lotMembership, lotMemberships.length + 1),
      tenant_id: TENANT,
      lot_id: lot.id,
      animal_id: animal.id,
      valid_from: ts(Math.min(animal._age, lot.closed ? 420 : intBetween(150, 340))),
      valid_to: lot.closed ? ts(52) : null,
      created_at: ts(380),
    });
    animal._lot = lot;
  }
});

insert(
  "lot",
  [
    "id",
    "tenant_id",
    "farm_id",
    "name",
    "purpose",
    "target",
    "responsible_id",
    "status",
    "started_at",
    "ended_at",
    "created_at",
  ],
  lotRows,
  "Lots — the management groups the operation actually thinks in.",
);

// ---------------------------------------------------------------------------
// Grazing: occupations and pasture assessments
// ---------------------------------------------------------------------------

const occupations = [];
const openLots = LOTS.filter((l) => !l.closed);
openLots.forEach((lot) => {
  // Rings are disjoint: two lots never stand in the same paddock at once.
  const pool = lot.farm === F1 ? paddocksF1 : paddocksF2;
  const sameFarm = openLots.filter((l) => l.farm === lot.farm);
  const slot = sameFarm.indexOf(lot);
  const ring = pool.filter((_, i) => i % sameFarm.length === slot);
  const cycle = ring.length > 0 ? ring : pool;
  // Rotational grazing: roughly a month per paddock, walked backwards from now.
  let cursor = 330;
  let step = 0;
  while (cursor > 0 && step < 12) {
    const paddock = cycle[step % cycle.length];
    const stay = intBetween(21, 38);
    const exit = Math.max(cursor - stay, 0);
    occupations.push({
      id: uuid(NS.occupation, occupations.length + 1),
      tenant_id: TENANT,
      paddock_id: paddock.id,
      lot_id: lot.id,
      entry_at: ts(cursor, 7),
      exit_at: exit === 0 ? null : ts(exit, 7),
      head_count: lot.members.length,
      created_at: ts(cursor, 7),
    });
    cursor = exit;
    step += 1;
    if (exit === 0) break;
  }
});
insert(
  "paddock_occupation",
  [
    "id",
    "tenant_id",
    "paddock_id",
    "lot_id",
    "entry_at",
    "exit_at",
    "head_count",
    "created_at",
  ],
  occupations,
  "Rotational grazing: each lot walks a ring of paddocks. The row with a NULL\n-- exit_at is where the lot stands today.",
);

const assessments = [];
for (const paddock of paddocks) {
  for (const daysBefore of [300, 240, 180, 120, 60, 18]) {
    const month = new Date(ANCHOR - daysBefore * DAY).getUTCMonth();
    const dry = month >= 5 && month <= 8;
    const kg = Math.round(dry ? between(1150, 2400) : between(2600, 5200));
    assessments.push({
      id: uuid(NS.assessment, assessments.length + 1),
      tenant_id: TENANT,
      paddock_id: paddock.id,
      assessed_at: ts(daysBefore, 8),
      method: pick(["visual", "rising_plate", "sward_stick", "cut_and_weigh"]),
      condition: dry
        ? pick(["poor", "fair", "fair", "good"])
        : pick(["fair", "good", "good", "excellent"]),
      availability_kg_dm_ha: kg,
      assessed_by: chance(0.6) ? TECH : MANAGER,
      notes:
        kg < 1500
          ? "Disponibilidade baixa — antecipar saída do lote."
          : kg > 4600
            ? "Pasto passando do ponto; avaliar vedação para feno."
            : null,
      event_id: null,
      created_at: ts(daysBefore, 8),
    });
  }
}
insert(
  "pasture_assessment",
  [
    "id",
    "tenant_id",
    "paddock_id",
    "assessed_at",
    "method",
    "condition",
    "availability_kg_dm_ha",
    "assessed_by",
    "notes",
    "event_id",
    "created_at",
  ],
  assessments,
  "Pasture assessments across the year — the dry season (Jun–Sep) shows in the\n-- availability figures.",
);

// ---------------------------------------------------------------------------
// Handling sessions, device observations, weights
// ---------------------------------------------------------------------------

const WEIGH_ROUNDS = [
  { days: 348, lots: ["nucleo", "recria", "engorda"] },
  { days: 300, lots: ["engorda", "cria"] },
  { days: 252, lots: ["nucleo", "recria", "engorda", "cria"] },
  { days: 198, lots: ["engorda", "recria"] },
  { days: 152, lots: ["nucleo", "cria", "engorda"] },
  { days: 104, lots: ["recria", "engorda", "cria"] },
  { days: 61, lots: ["nucleo", "recria", "engorda", "cria", "quarentena"] },
  { days: 26, lots: ["engorda", "cria"] },
  { days: 6, lots: ["recria", "engorda"] },
];

const sessions = [];
const observations = [];
const weights = [];

WEIGH_ROUNDS.forEach((round, ri) => {
  const lots = LOTS.filter((l) => round.lots.includes(l.key));
  const members = lots.flatMap((l) => l.members).filter((a) => a._age > round.days);
  const sessionId = uuid(NS.session, ri + 1);
  const farmId = lots[0].farm;
  sessions.push({
    id: sessionId,
    tenant_id: TENANT,
    farm_id: farmId,
    purpose: "weighing",
    status: "open",
    device_id: "balanca-tru-test-01",
    operator_id: TECH,
    expected_count: members.length,
    started_at: ts(round.days, 6, 30),
    closed_at: null,
    summary: null,
    created_at: ts(round.days, 6, 30),
    _members: members,
    _round: round,
  });
});

// Close every session but the most recent one, so the console shows both an
// open session and a history of closed ones.
sessions.forEach((session, i) => {
  const round = session._round;
  const members = session._members;
  let recorded = 0;
  members.forEach((animal, mi) => {
    // Not every animal comes up the race every round.
    if (!chance(0.93)) return;
    const kg = weightAt(animal, round.days);
    if (kg === null || kg <= 0) return;
    recorded += 1;
    const observationId = uuid(NS.observation, observations.length + 1);
    const rfid = `982${String(100000000000 + animals.indexOf(animal)).slice(-12)}`;
    // A small share of reads land without a resolvable tag and wait for a
    // human — the pending_resolution path the console surfaces.
    const orphan = chance(0.02);
    observations.push({
      id: observationId,
      tenant_id: TENANT,
      handling_session_id: session.id,
      gateway_id: "gw-curral-sede",
      device_id: "balanca-tru-test-01",
      observation_id: `obs-${String(observations.length + 1).padStart(6, "0")}`,
      captured_at: ts(round.days, 7, (mi * 3) % 60),
      measurement_type: "weight",
      raw_value: kg,
      unit: "kg",
      rfid: orphan ? null : rfid,
      raw_payload: json({
        protocol: "tru-test-serial-v2",
        stable: true,
        raw: `${kg}kg`,
      }),
      quality_flags: orphan ? arr(["unresolved_tag"]) : arr([]),
      resolution_status: orphan ? "pending_resolution" : "accepted",
      resolved_animal_id: orphan ? null : animal.id,
      normalized_weight_kg: kg,
      event_id: null,
      recorded_at: ts(round.days, 7, (mi * 3) % 60),
    });
    if (orphan) return;

    const eventId = appendEvent({
      eventType: "weighing.animal_weighed.v1",
      aggregateType: "animal",
      aggregateId: animal.id,
      farmId: animal.farm_id,
      occurredAt: ts(round.days, 7, (mi * 3) % 60),
      actorId: TECH,
      sourceChannel: "device",
      payload: { visualId: animal.visual_id, weightKg: kg, sessionId: session.id },
      publish: i >= sessions.length - 2,
    });
    observations[observations.length - 1].event_id = eventId;
    // A handful of weighings are flagged and excluded from analytics — a wet
    // animal, a jumpy read. The rule must be visible in the data, not implied.
    const suspect = chance(0.03);
    weights.push({
      id: uuid(NS.weight, weights.length + 1),
      tenant_id: TENANT,
      animal_id: animal.id,
      occurred_at: ts(round.days, 7, (mi * 3) % 60),
      weight_kg: kg,
      eligible_for_analytics: !suspect,
      quality_flags: suspect ? arr(["unstable_reading"]) : arr([]),
      source_observation_id: observationId,
      event_id: eventId,
      calculated_at: ts(round.days, 7, (mi * 3) % 60),
    });
  });
  session.expected_count = members.length;
  if (i < sessions.length - 1) {
    session.status = "closed";
    session.closed_at = ts(round.days, 11, 45);
    session.summary = json({
      recorded,
      expected: members.length,
      missing: members.length - recorded,
      operator: "Douglas Prestes Amaral",
    });
  }
});

insert(
  "handling_session",
  [
    "id",
    "tenant_id",
    "farm_id",
    "purpose",
    "status",
    "device_id",
    "operator_id",
    "expected_count",
    "started_at",
    "closed_at",
    "summary",
    "created_at",
  ],
  sessions.map(({ _members, _round, ...row }) => row),
  "Weighing sessions. The newest one is still open — that is the screen an\n-- operator would be looking at in the corral right now.",
);

insert(
  "device_observation",
  [
    "id",
    "tenant_id",
    "handling_session_id",
    "gateway_id",
    "device_id",
    "observation_id",
    "captured_at",
    "measurement_type",
    "raw_value",
    "unit",
    "rfid",
    "raw_payload",
    "quality_flags",
    "resolution_status",
    "resolved_animal_id",
    "normalized_weight_kg",
    "event_id",
    "recorded_at",
  ],
  observations,
  "Raw device evidence is preserved alongside the resolved weight (§27): the\n-- reads that could not be matched to a tag stay as pending_resolution.",
);

// ---------------------------------------------------------------------------
// Identity: RFID, visual, and official tags
// ---------------------------------------------------------------------------

const identifiers = [];
animals.forEach((animal, i) => {
  const rfid = `982${String(100000000000 + i).slice(-12)}`;
  identifiers.push({
    id: uuid(NS.identifier, identifiers.length + 1),
    tenant_id: TENANT,
    animal_id: animal.id,
    identifier_type: "rfid",
    identifier_value: rfid,
    valid_from: ts(Math.min(animal._age - 5, 870)),
    valid_to: null,
    assigned_by: TECH,
    created_at: ts(Math.min(animal._age - 5, 870)),
  });
  identifiers.push({
    id: uuid(NS.identifier, identifiers.length + 1),
    tenant_id: TENANT,
    animal_id: animal.id,
    identifier_type: "visual",
    identifier_value: animal.visual_id,
    valid_from: ts(Math.min(animal._age - 5, 870)),
    valid_to: null,
    assigned_by: TECH,
    created_at: ts(Math.min(animal._age - 5, 870)),
  });
  // Breeding stock carries an official number; the terminal animals do not.
  if (["matriz", "touro", "novilha"].includes(animal._group)) {
    identifiers.push({
      id: uuid(NS.identifier, identifiers.length + 1),
      tenant_id: TENANT,
      animal_id: animal.id,
      identifier_type: "official",
      identifier_value: `BR ${String(4200000000000 + i * 7).slice(0, 13)}`,
      valid_from: ts(Math.min(animal._age - 5, 860)),
      valid_to: null,
      assigned_by: GENETICS,
      created_at: ts(Math.min(animal._age - 5, 860)),
    });
  }
  // A few animals lost a button tag and were retagged — identity is stable
  // across the change, which is the whole point of invariant 3.
  if (chance(0.05)) {
    const fromDays = Math.min(animal._age - 5, 869);
    // The replacement always lands after the original assignment.
    const retagged = ts(Math.max(Math.floor(fromDays * 0.4), 3));
    identifiers.push({
      id: uuid(NS.identifier, identifiers.length + 1),
      tenant_id: TENANT,
      animal_id: animal.id,
      identifier_type: "legacy",
      identifier_value: `JQ-ANT-${String(i + 1).padStart(4, "0")}`,
      valid_from: ts(Math.min(animal._age - 5, 869)),
      valid_to: retagged,
      assigned_by: TECH,
      created_at: ts(Math.min(animal._age - 5, 869)),
    });
  }
});

// ---------------------------------------------------------------------------
// Parentage
// ---------------------------------------------------------------------------

const dams = byGroup("matriz");
const bulls = byGroup("touro");
const parentage = [];
for (const calf of [
  ...byGroup("bezerra"),
  ...byGroup("bezerro"),
  ...byGroup("novilha"),
]) {
  const dam = dams[Math.floor(rand() * dams.length)];
  parentage.push({
    id: uuid(NS.parentage, parentage.length + 1),
    tenant_id: TENANT,
    child_id: calf.id,
    parent_id: dam.id,
    external_parent_ref: null,
    relation: "dam",
    confidence: "known",
    created_at: ts(Math.max(calf._age - 1, 1)),
  });
  // Sire is either a farm bull or an AI straw from an external sire.
  if (chance(0.55)) {
    parentage.push({
      id: uuid(NS.parentage, parentage.length + 1),
      tenant_id: TENANT,
      child_id: calf.id,
      parent_id: bulls[Math.floor(rand() * bulls.length)].id,
      external_parent_ref: null,
      relation: "sire",
      confidence: chance(0.8) ? "known" : "probable",
      created_at: ts(Math.max(calf._age - 1, 1)),
    });
  } else {
    parentage.push({
      id: uuid(NS.parentage, parentage.length + 1),
      tenant_id: TENANT,
      child_id: calf.id,
      parent_id: null,
      external_parent_ref: `SEMEN/BRANGUS/${pick(["CVM", "TBR", "RDG", "MPX"])}-${intBetween(1000, 9999)}`,
      relation: "sire",
      confidence: "known",
      created_at: ts(Math.max(calf._age - 1, 1)),
    });
  }
}

// ---------------------------------------------------------------------------
// Health: protocols, treatments, withdrawal restrictions, cases
// ---------------------------------------------------------------------------

const PROTOCOLS = [
  {
    name: "Clostridioses — polivalente 10 vias",
    applies: "todos os bovinos a partir de 4 meses",
    schedule: {
      doses: [
        {
          atAgeDays: 120,
          product: "Vacina polivalente clostridial",
          route: "subcutaneous",
        },
        {
          offsetDays: 30,
          product: "Vacina polivalente clostridial (reforço)",
          route: "subcutaneous",
        },
      ],
      annualBooster: true,
    },
  },
  {
    name: "Raiva dos herbívoros — anual",
    applies: "todo o rebanho (área de morcego hematófago)",
    schedule: {
      doses: [{ atAgeDays: 90, product: "Vacina antirrábica", route: "subcutaneous" }],
      annualBooster: true,
    },
  },
  {
    name: "Brucelose B19 — fêmeas 3 a 8 meses",
    applies: "fêmeas entre 3 e 8 meses",
    schedule: {
      doses: [{ atAgeDays: 120, product: "Vacina B19", route: "subcutaneous" }],
      oncePerLife: true,
    },
  },
  {
    name: "Controle estratégico de endoparasitas",
    applies: "recria e engorda",
    schedule: {
      doses: [
        {
          month: 5,
          product: "Ivermectina 3,15% LA",
          route: "subcutaneous",
          withdrawalDays: 35,
        },
        {
          month: 7,
          product: "Levamisol 7,5%",
          route: "subcutaneous",
          withdrawalDays: 12,
        },
        {
          month: 9,
          product: "Ivermectina 3,15% LA",
          route: "subcutaneous",
          withdrawalDays: 35,
        },
      ],
    },
  },
  {
    name: "IBR/BVD — matrizes pré-IATF",
    applies: "matrizes e novilhas aptas",
    schedule: {
      doses: [
        {
          offsetDaysBeforeBreeding: 45,
          product: "Vacina IBR/BVD",
          route: "intramuscular",
        },
      ],
    },
  },
  {
    name: "Controle de mosca-do-chifre e carrapato",
    applies: "todos os lotes em pastagem",
    schedule: {
      doses: [{ product: "Cipermetrina pour-on", route: "topical", withdrawalDays: 7 }],
      trigger: "contagem > 200 moscas/animal",
    },
  },
];

const protocolRows = PROTOCOLS.map((p, i) => ({
  id: uuid(NS.protocol, i + 1),
  tenant_id: TENANT,
  farm_id: null, // tenant-wide protocols apply on both blocks
  name: p.name,
  species_code: "BOVINE",
  applies_to: p.applies,
  version: 1,
  schedule: json(p.schedule),
  status: "active",
  created_at: ts(700),
}));

const PRODUCTS = [
  {
    name: "Vacina polivalente clostridial",
    kind: "vaccination",
    dose: 5,
    unit: "mL",
    route: "subcutaneous",
    withdrawal: 0,
    protocol: 0,
  },
  {
    name: "Vacina antirrábica",
    kind: "vaccination",
    dose: 2,
    unit: "mL",
    route: "subcutaneous",
    withdrawal: 0,
    protocol: 1,
  },
  {
    name: "Vacina B19",
    kind: "vaccination",
    dose: 2,
    unit: "mL",
    route: "subcutaneous",
    withdrawal: 0,
    protocol: 2,
  },
  {
    name: "Ivermectina 3,15% LA",
    kind: "treatment",
    dose: 8,
    unit: "mL",
    route: "subcutaneous",
    withdrawal: 35,
    protocol: 3,
  },
  {
    name: "Levamisol 7,5%",
    kind: "treatment",
    dose: 10,
    unit: "mL",
    route: "subcutaneous",
    withdrawal: 12,
    protocol: 3,
  },
  {
    name: "Cipermetrina pour-on",
    kind: "treatment",
    dose: 30,
    unit: "mL",
    route: "topical",
    withdrawal: 7,
    protocol: 5,
  },
  {
    name: "Vacina IBR/BVD",
    kind: "vaccination",
    dose: 5,
    unit: "mL",
    route: "intramuscular",
    withdrawal: 0,
    protocol: 4,
  },
  {
    name: "Oxitetraciclina LA 20%",
    kind: "treatment",
    dose: 20,
    unit: "mL",
    route: "intramuscular",
    withdrawal: 28,
    protocol: null,
  },
  {
    name: "Closantel 10%",
    kind: "treatment",
    dose: 12,
    unit: "mL",
    route: "subcutaneous",
    withdrawal: 42,
    protocol: null,
  },
];

const treatments = [];
const restrictions = [];
for (const animal of animals) {
  if (animal.lifecycle_status === "deceased") continue;
  const rounds = intBetween(2, 5);
  for (let r = 0; r < rounds; r += 1) {
    const product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
    const daysAgo = intBetween(4, Math.min(animal._age, 400));
    const administeredAt = ts(daysAgo, 8, intBetween(0, 55));
    const treatmentId = uuid(NS.treatment, treatments.length + 1);
    const withdrawalUntil =
      product.withdrawal > 0 ? ts(daysAgo - product.withdrawal, 8, 0) : null;
    const eventId = appendEvent({
      eventType:
        product.kind === "vaccination"
          ? "health.vaccination_administered.v1"
          : "health.treatment_administered.v1",
      aggregateType: "animal",
      aggregateId: animal.id,
      farmId: animal.farm_id,
      occurredAt: administeredAt,
      actorId: VET,
      payload: {
        visualId: animal.visual_id,
        productName: product.name,
        doseUnit: product.unit,
        withdrawalDays: product.withdrawal,
      },
      publish: daysAgo < 30,
    });
    treatments.push({
      id: treatmentId,
      tenant_id: TENANT,
      animal_id: animal.id,
      protocol_id:
        product.protocol === null ? null : uuid(NS.protocol, product.protocol + 1),
      kind: product.kind,
      product_name: product.name,
      medicine_batch: `L${intBetween(100, 999)}-${day(daysAgo).slice(0, 4)}`,
      dose: product.dose,
      dose_unit: product.unit,
      route: product.route,
      administered_by: chance(0.65) ? VET : TECH,
      administered_at: administeredAt,
      withdrawal_until: withdrawalUntil,
      notes: null,
      event_id: eventId,
      created_at: administeredAt,
    });
    // The restriction is the enforcement surface: while it is active the
    // animal cannot be cleared for sale (JK-DOM health rule).
    if (product.withdrawal > 0) {
      const stillActive = daysAgo < product.withdrawal;
      restrictions.push({
        id: uuid(NS.restriction, restrictions.length + 1),
        tenant_id: TENANT,
        animal_id: animal.id,
        restriction_type: "withdrawal",
        source_treatment_id: treatmentId,
        reason: `Carência de ${product.withdrawal} dias — ${product.name}`,
        valid_from: administeredAt,
        valid_to: ts(daysAgo - product.withdrawal, 8, 0),
        status: stillActive ? "active" : "lifted",
        lifted_by: stillActive ? null : VET,
        lifted_reason: stillActive ? null : "Prazo de carência cumprido.",
        lifted_at: stillActive ? null : ts(daysAgo - product.withdrawal, 8, 5),
        created_at: administeredAt,
      });
    }
  }
}

// Quarantine holds on the animals in the quarantine lot.
for (const animal of byGroup("quarentena")) {
  restrictions.push({
    id: uuid(NS.restriction, restrictions.length + 1),
    tenant_id: TENANT,
    animal_id: animal.id,
    restriction_type: "quarantine",
    source_treatment_id: null,
    reason:
      "Quarentena de entrada — 21 dias de observação e exames de brucelose e tuberculose.",
    valid_from: ts(11),
    valid_to: ts(-10),
    status: "active",
    lifted_by: null,
    lifted_reason: null,
    lifted_at: null,
    created_at: ts(11),
  });
}

const CASES = [
  {
    symptom: "Miíase umbilical",
    diagnosis: "Bicheira em bezerro recém-nascido",
    outcome: "Curado após larvicida e repelente.",
  },
  {
    symptom: "Apatia, febre e mucosas pálidas",
    diagnosis: "Tristeza parasitária bovina (Babesia bovis)",
    outcome: "Tratado com dipropionato de imidocarb; recuperado.",
  },
  {
    symptom: "Claudicação em membro posterior",
    diagnosis: "Pododermatite interdigital",
    outcome: "Casqueamento e antibiótico; resolvido.",
  },
  {
    symptom: "Tosse seca e taquipneia",
    diagnosis: "Broncopneumonia em bezerro desmamado",
    outcome: null,
  },
  {
    symptom: "Queda de escore corporal",
    diagnosis: "Verminose de alta carga",
    outcome: "Vermifugado e realocado para pasto de melhor qualidade.",
  },
  {
    symptom: "Secreção ocular e opacidade de córnea",
    diagnosis: "Ceratoconjuntivite infecciosa bovina",
    outcome: null,
  },
];
const healthCases = CASES.map((c, i) => {
  const animal = activeHerd[Math.floor(rand() * activeHerd.length)];
  const openedDays = intBetween(3, 200);
  const resolved = c.outcome !== null;
  return {
    id: uuid(NS.healthCase, i + 1),
    tenant_id: TENANT,
    animal_id: animal.id,
    opened_by: VET,
    opened_at: ts(openedDays, 10),
    symptom: c.symptom,
    diagnosis: c.diagnosis,
    status: resolved ? "resolved" : "open",
    outcome: c.outcome,
    closed_at: resolved ? ts(Math.max(openedDays - intBetween(3, 14), 1), 16) : null,
    created_at: ts(openedDays, 10),
  };
});

// ---------------------------------------------------------------------------
// Reproduction: services, pregnancy checks, calvings
// ---------------------------------------------------------------------------

const breeders = [...dams, ...byGroup("novilha").filter((a) => a._age > 620)];
const services = [];
const pregnancyChecks = [];
const calvings = [];

/**
 * One breeding station for one dam: service → diagnosis at ~35 days → either a
 * loss on re-check or, once the ~285-day gestation has run, a calving. The
 * previous station is what produced the calves standing in the paddock today;
 * the current one is still in gestation, which is why most of its dams have a
 * positive diagnosis and no calving row yet.
 */
function station(dam, serviceDays) {
  const method = chance(0.72) ? "tai" : chance(0.6) ? "ai" : "natural";
  const serviceId = uuid(NS.service, services.length + 1);
  const serviceEvent = appendEvent({
    eventType: "reproduction.service_recorded.v1",
    aggregateType: "animal",
    aggregateId: dam.id,
    farmId: dam.farm_id,
    occurredAt: ts(serviceDays, 7),
    actorId: GENETICS,
    payload: { visualId: dam.visual_id, method },
  });
  services.push({
    id: serviceId,
    tenant_id: TENANT,
    dam_id: dam.id,
    method,
    service_date: ts(serviceDays, 7),
    bull_id: method === "natural" ? bulls[Math.floor(rand() * bulls.length)].id : null,
    external_sire_ref:
      method === "natural"
        ? null
        : `SEMEN/BRANGUS/${pick(["CVM", "TBR", "RDG", "MPX"])}-${intBetween(1000, 9999)}`,
    semen_batch: method === "natural" ? null : `PART-${intBetween(10000, 99999)}`,
    technician_id: GENETICS,
    notes:
      method === "tai" ? "Protocolo IATF de 10 dias com implante de progesterona." : null,
    event_id: serviceEvent,
    created_at: ts(serviceDays, 7),
  });

  // Diagnosis at ~35 days, confirmation at ~90.
  const conceived = chance(0.79);
  const checkDays = serviceDays - 35;
  pregnancyChecks.push({
    id: uuid(NS.pregnancy, pregnancyChecks.length + 1),
    tenant_id: TENANT,
    dam_id: dam.id,
    service_id: serviceId,
    check_date: ts(checkDays, 9),
    method: "ultrasound",
    result: conceived ? "positive" : "negative",
    gestation_days_estimate: conceived ? 35 : null,
    expected_calving_date: conceived ? day(serviceDays - 285) : null,
    event_id: appendEvent({
      eventType: "reproduction.pregnancy_checked.v1",
      aggregateType: "animal",
      aggregateId: dam.id,
      farmId: dam.farm_id,
      occurredAt: ts(checkDays, 9),
      actorId: VET,
      payload: {
        visualId: dam.visual_id,
        result: conceived ? "positive" : "negative",
        method: "ultrasound",
      },
    }),
    created_at: ts(checkDays, 9),
  });

  if (!conceived) return;

  const lossDays = serviceDays - 120;
  const lost = chance(0.05);
  if (lost) {
    pregnancyChecks.push({
      id: uuid(NS.pregnancy, pregnancyChecks.length + 1),
      tenant_id: TENANT,
      dam_id: dam.id,
      service_id: serviceId,
      check_date: ts(lossDays, 9),
      method: "ultrasound",
      result: "loss",
      gestation_days_estimate: 120,
      expected_calving_date: null,
      event_id: appendEvent({
        eventType: "reproduction.pregnancy_checked.v1",
        aggregateType: "animal",
        aggregateId: dam.id,
        farmId: dam.farm_id,
        occurredAt: ts(lossDays, 9),
        actorId: VET,
        payload: { visualId: dam.visual_id, result: "loss", method: "ultrasound" },
      }),
      created_at: ts(lossDays, 9),
    });
    return;
  }

  // Gestation is ~285 days; the ones already born become the 2025/2026 calves.
  const calvingDays = serviceDays - 285;
  if (calvingDays <= 0) return;
  const outcome = chance(0.955) ? "live" : chance(0.6) ? "stillborn" : "aborted";
  const calf =
    outcome === "live"
      ? [...byGroup("bezerra"), ...byGroup("bezerro")].find(
          (c) => !c._assignedDam && Math.abs(c._age - calvingDays) < 45,
        )
      : null;
  if (calf) calf._assignedDam = dam.id;
  calvings.push({
    id: uuid(NS.calving, calvings.length + 1),
    tenant_id: TENANT,
    dam_id: dam.id,
    service_id: serviceId,
    calving_date: ts(calvingDays, 5, intBetween(0, 59)),
    ease: pick(["unassisted", "unassisted", "unassisted", "easy_pull", "hard_pull"]),
    outcome,
    calf_id: calf ? calf.id : null,
    birth_weight_kg: outcome === "live" ? Number(between(27, 39).toFixed(1)) : null,
    sire_confidence: method === "natural" ? "probable" : "known",
    event_id: appendEvent({
      eventType: "reproduction.calving_recorded.v1",
      aggregateType: "animal",
      aggregateId: dam.id,
      farmId: dam.farm_id,
      occurredAt: ts(calvingDays, 5),
      actorId: TECH,
      payload: {
        visualId: dam.visual_id,
        outcome,
        calfVisualId: calf?.visual_id ?? null,
      },
      publish: calvingDays < 60,
    }),
    created_at: ts(calvingDays, 5),
  });
}

// The 2024/2025 station, whose calves are the ones on the ground today.
for (const dam of dams) {
  station(dam, intBetween(495, 535));
}
// The 2025/2026 station: served last spring, most of it still in gestation.
for (const dam of breeders) {
  station(dam, intBetween(230, 260));
}

// ---------------------------------------------------------------------------
// Genetics
// ---------------------------------------------------------------------------

const TRAITS = [
  { code: "PN", label: "peso ao nascer", mean: 1.2, sd: 1.6 },
  { code: "P240", label: "peso aos 240 dias", mean: 8.5, sd: 6.2 },
  { code: "P365", label: "peso aos 365 dias", mean: 14.0, sd: 9.5 },
  { code: "PE365", label: "perímetro escrotal aos 365 dias", mean: 0.7, sd: 0.9 },
  { code: "MP240", label: "habilidade materna aos 240 dias", mean: 4.1, sd: 3.3 },
  { code: "IPP", label: "idade ao primeiro parto", mean: -12.0, sd: 9.0 },
  { code: "ACAB", label: "acabamento de carcaça", mean: 0.35, sd: 0.4 },
];

const geneticEvaluations = [];
const evaluated = [...bulls, ...dams, ...byGroup("novilha")];
for (const animal of evaluated) {
  for (const trait of TRAITS) {
    // Box–Muller from the seeded PRNG, so the spread is normal and stable.
    const u1 = Math.max(rand(), 1e-9);
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const value = Number((trait.mean + z * trait.sd).toFixed(2));
    geneticEvaluations.push({
      id: uuid(NS.genetic, geneticEvaluations.length + 1),
      tenant_id: TENANT,
      animal_id: animal.id,
      provider: "ABCZ/Programa Brangus",
      evaluation_date: day(120),
      trait: trait.code,
      value,
      percentile: Number(between(1, 99).toFixed(1)),
      reliability: Number(between(0.35, 0.92).toFixed(2)),
      source_file: "sumario-brangus-2026-1.csv",
      event_id: null,
      imported_at: ts(118),
    });
  }
}

const selectionIndexes = [
  {
    id: uuid(NS.index, 1),
    tenant_id: TENANT,
    name: "Índice JQ Terminal",
    version: 1,
    weights: json({ P365: 0.4, ACAB: 0.25, PE365: 0.2, PN: -0.15 }),
    missing_data_behavior: "exclude",
    created_at: ts(140),
  },
  {
    id: uuid(NS.index, 2),
    tenant_id: TENANT,
    name: "Índice JQ Materno",
    version: 2,
    weights: json({ MP240: 0.35, IPP: -0.3, P240: 0.2, PN: -0.15 }),
    missing_data_behavior: "exclude",
    created_at: ts(96),
  },
];

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const ITEMS = [
  {
    name: "Sal mineral proteinado 30%",
    category: "feed",
    unit: "kg",
    supplier: "Nutripasto Vale do Paraíba",
    reorder: 1500,
  },
  {
    name: "Ração concentrada 22% PB",
    category: "feed",
    unit: "kg",
    supplier: "Cooperativa Agropecuária de Cunha",
    reorder: 2000,
  },
  {
    name: "Núcleo mineral seca",
    category: "mineral",
    unit: "kg",
    supplier: "Nutripasto Vale do Paraíba",
    reorder: 900,
  },
  {
    name: "Ureia pecuária",
    category: "feed",
    unit: "kg",
    supplier: "Cooperativa Agropecuária de Cunha",
    reorder: 400,
  },
  {
    name: "Vacina polivalente clostridial",
    category: "medicine",
    unit: "dose",
    supplier: "Distribuidora Agroserra",
    reorder: 250,
  },
  {
    name: "Vacina antirrábica",
    category: "medicine",
    unit: "dose",
    supplier: "Distribuidora Agroserra",
    reorder: 200,
  },
  {
    name: "Ivermectina 3,15% LA",
    category: "medicine",
    unit: "mL",
    supplier: "Distribuidora Agroserra",
    reorder: 1200,
  },
  {
    name: "Cipermetrina pour-on",
    category: "medicine",
    unit: "mL",
    supplier: "Distribuidora Agroserra",
    reorder: 800,
  },
  {
    name: "Brinco eletrônico ISO 11784",
    category: "tag",
    unit: "un",
    supplier: "IdentiGado",
    reorder: 120,
  },
  {
    name: "Brinco visual numerado",
    category: "tag",
    unit: "un",
    supplier: "IdentiGado",
    reorder: 150,
  },
  {
    name: "Sêmen Brangus — palheta",
    category: "consumable",
    unit: "un",
    supplier: "Central Genética Sudeste",
    reorder: 60,
  },
  {
    name: "Nitrogênio líquido",
    category: "consumable",
    unit: "L",
    supplier: "Central Genética Sudeste",
    reorder: 30,
  },
  {
    name: "Adubo NPK 20-05-20",
    category: "other",
    unit: "kg",
    supplier: "Cooperativa Agropecuária de Cunha",
    reorder: 3000,
  },
  {
    name: "Calcário dolomítico",
    category: "other",
    unit: "t",
    supplier: "Mineradora Serra Nova",
    reorder: 12,
  },
  {
    name: "Arame liso 2,7 mm",
    category: "other",
    unit: "kg",
    supplier: "Casa do Produtor Cunha",
    reorder: 200,
  },
];

const itemRows = ITEMS.map((it, i) => ({
  id: uuid(NS.item, i + 1),
  tenant_id: TENANT,
  name: it.name,
  category: it.category,
  unit: it.unit,
  supplier: it.supplier,
  reorder_level: it.reorder,
  created_at: ts(760),
}));

const batches = [];
const stockMovements = [];
ITEMS.forEach((it, i) => {
  const itemId = uuid(NS.item, i + 1);
  const batchCount = intBetween(2, 4);
  let balance = 0;
  for (let b = 0; b < batchCount; b += 1) {
    const receivedDays = intBetween(20, 420);
    const batchId = uuid(NS.batch, batches.length + 1);
    batches.push({
      id: batchId,
      tenant_id: TENANT,
      item_id: itemId,
      batch_code: `${it.name.slice(0, 3).toUpperCase()}-${day(receivedDays).replace(/-/g, "")}-${b + 1}`,
      expiration_date:
        it.category === "medicine" || it.category === "consumable"
          ? day(receivedDays - intBetween(300, 720))
          : null,
      received_at: ts(receivedDays, 14),
      created_at: ts(receivedDays, 14),
    });
    const qty = Math.round(it.reorder * between(1.2, 3.4));
    balance += qty;
    stockMovements.push({
      id: uuid(NS.stock, stockMovements.length + 1),
      tenant_id: TENANT,
      item_id: itemId,
      batch_id: batchId,
      movement_type: "receipt",
      quantity_delta: qty,
      unit: it.unit,
      animal_id: null,
      lot_id: null,
      paddock_id: null,
      work_order_id: null,
      reason: `Nota de entrada — ${it.supplier}`,
      occurred_at: ts(receivedDays, 14),
      recorded_at: ts(receivedDays, 14),
      event_id: null,
    });
    // Draw the batch down over the months that follow.
    const draws = intBetween(3, 7);
    for (let d = 0; d < draws; d += 1) {
      const when = Math.max(receivedDays - (d + 1) * intBetween(12, 40), 2);
      const take = Math.round(qty * between(0.08, 0.22));
      if (take <= 0 || balance - take < 0) continue;
      balance -= take;
      const lot = openLots[Math.floor(rand() * openLots.length)];
      stockMovements.push({
        id: uuid(NS.stock, stockMovements.length + 1),
        tenant_id: TENANT,
        item_id: itemId,
        batch_id: batchId,
        movement_type: "consumption",
        quantity_delta: -take,
        unit: it.unit,
        animal_id: null,
        lot_id: lot.id,
        paddock_id: null,
        work_order_id: null,
        reason: `Consumo no lote ${lot.name}`,
        occurred_at: ts(when, 11),
        recorded_at: ts(when, 11),
        event_id: null,
      });
    }
  }
  // One count adjustment and one disposal, so every movement type appears.
  if (i % 5 === 0) {
    stockMovements.push({
      id: uuid(NS.stock, stockMovements.length + 1),
      tenant_id: TENANT,
      item_id: itemId,
      batch_id: null,
      movement_type: "adjustment",
      quantity_delta: -Math.round(it.reorder * 0.03),
      unit: it.unit,
      animal_id: null,
      lot_id: null,
      paddock_id: null,
      work_order_id: null,
      reason: "Ajuste de inventário — contagem física do almoxarifado.",
      occurred_at: ts(intBetween(30, 120), 15),
      recorded_at: ts(intBetween(30, 120), 15),
      event_id: null,
    });
  }
  if (i % 7 === 3) {
    stockMovements.push({
      id: uuid(NS.stock, stockMovements.length + 1),
      tenant_id: TENANT,
      item_id: itemId,
      batch_id: null,
      movement_type: "disposal",
      quantity_delta: -Math.round(it.reorder * 0.05),
      unit: it.unit,
      animal_id: null,
      lot_id: null,
      paddock_id: null,
      work_order_id: null,
      reason: "Descarte por vencimento do lote.",
      occurred_at: ts(intBetween(20, 90), 15),
      recorded_at: ts(intBetween(20, 90), 15),
      event_id: null,
    });
  }
});

// ---------------------------------------------------------------------------
// Assets and maintenance
// ---------------------------------------------------------------------------

const ASSETS = [
  {
    name: "Balança eletrônica de curral",
    type: "scale",
    model: "Tru-Test S3",
    serial: "TT-S3-44192",
    location: "Curral da Sede",
    farm: F1,
    calibration: -35,
  },
  {
    name: "Balança de brete — Retiro",
    type: "scale",
    model: "Coimma 2000",
    serial: "CM-2K-10877",
    location: "Curral do Retiro",
    farm: F2,
    calibration: 12,
  },
  {
    name: "Bastão leitor RFID",
    type: "rfid_reader",
    model: "Allflex RS420",
    serial: "AF-RS420-7731",
    location: "Curral da Sede",
    farm: F1,
    calibration: null,
  },
  {
    name: "Gateway de curral",
    type: "gateway",
    model: "SAGA Edge GW-1",
    serial: "GW-0001",
    location: "Curral da Sede",
    farm: F1,
    calibration: null,
  },
  {
    name: "Trator 75 cv",
    type: "machinery",
    model: "Massey Ferguson 4275",
    serial: "MF-4275-2210",
    location: "Galpão de máquinas",
    farm: F1,
    calibration: null,
  },
  {
    name: "Distribuidor de calcário",
    type: "machinery",
    model: "Baldan DCA 4000",
    serial: "BD-4000-8812",
    location: "Galpão de máquinas",
    farm: F1,
    calibration: null,
  },
  {
    name: "Caminhonete de campo",
    type: "vehicle",
    model: "Toyota Hilux 2019",
    serial: "PLACA-SINTETICA-001",
    location: "Sede",
    farm: F1,
    calibration: null,
  },
  {
    name: "Bomba d'água solar",
    type: "pump",
    model: "Shurflo 9325",
    serial: "SF-9325-5540",
    location: "Nascente da Grota Funda",
    farm: F1,
    calibration: null,
  },
  {
    name: "Eletrificador de cerca",
    type: "fence",
    model: "Zebu ZB-120",
    serial: "ZB-120-3391",
    location: "Divisa leste",
    farm: F1,
    calibration: null,
  },
  {
    name: "Tronco de contenção",
    type: "corral",
    model: "Coimma Bravo",
    serial: "CB-7742",
    location: "Curral da Sede",
    farm: F1,
    calibration: null,
  },
  {
    name: "Botijão criogênico",
    type: "other",
    model: "Taylor-Wharton XT34",
    serial: "TW-XT34-1180",
    location: "Sala de sêmen",
    farm: F1,
    calibration: null,
  },
  {
    name: "Cocho coberto — Retiro",
    type: "other",
    model: null,
    serial: null,
    location: "Paraitinga Alto",
    farm: F2,
    calibration: null,
  },
];

const assetRows = ASSETS.map((a, i) => ({
  id: uuid(NS.asset, i + 1),
  tenant_id: TENANT,
  farm_id: a.farm,
  name: a.name,
  asset_type: a.type,
  model: a.model,
  serial: a.serial,
  location: a.location,
  status: i === 5 ? "maintenance" : "active",
  responsible_id: MANAGER,
  // A negative offset is in the future; the scale that is already past due is
  // what raises the calibration alert further down.
  calibration_valid_until: a.calibration === null ? null : ts(a.calibration, 12),
  created_at: ts(intBetween(400, 800)),
}));

const maintenanceSchedules = [];
ASSETS.forEach((a, i) => {
  const kind = a.type === "scale" ? "calibration" : "preventive";
  const interval = kind === "calibration" ? 365 : pick([90, 180, 250]);
  const lastDone = intBetween(30, interval + 60);
  maintenanceSchedules.push({
    id: uuid(NS.maintenance, maintenanceSchedules.length + 1),
    tenant_id: TENANT,
    asset_id: uuid(NS.asset, i + 1),
    kind,
    interval_days: interval,
    last_done_at: ts(lastDone, 13),
    next_due_at: ts(lastDone - interval, 13),
    created_at: ts(lastDone, 13),
  });
});

const WORK_ORDERS = [
  {
    asset: 5,
    priority: "high",
    description:
      "Distribuidor de calcário com rolamento do disco travado; parado no galpão.",
    status: "in_progress",
    labor: 380,
    parts: 640,
    downtime: 26,
  },
  {
    asset: 1,
    priority: "urgent",
    description:
      "Balança do Retiro fora de calibração — desvio de 4 kg contra peso padrão.",
    status: "open",
    labor: null,
    parts: null,
    downtime: null,
  },
  {
    asset: 7,
    priority: "normal",
    description:
      "Trocar painel solar da bomba da Grota Funda (vidro trincado por granizo).",
    status: "open",
    labor: null,
    parts: null,
    downtime: null,
  },
  {
    asset: 8,
    priority: "normal",
    description: "Revisar aterramento do eletrificador na divisa leste.",
    status: "done",
    labor: 150,
    parts: 95,
    downtime: 3,
  },
  {
    asset: 4,
    priority: "low",
    description: "Revisão de 250 horas do trator.",
    status: "done",
    labor: 420,
    parts: 1180,
    downtime: 8,
  },
  {
    asset: 6,
    priority: "normal",
    description: "Troca de pastilhas de freio da caminhonete.",
    status: "done",
    labor: 260,
    parts: 720,
    downtime: 5,
  },
  {
    asset: 9,
    priority: "low",
    description: "Soldar batente do tronco de contenção.",
    status: "cancelled",
    labor: null,
    parts: null,
    downtime: null,
  },
];
const workOrders = WORK_ORDERS.map((w, i) => {
  const opened = intBetween(5, 240);
  const done = w.status === "done" || w.status === "cancelled";
  return {
    id: uuid(NS.workOrder, i + 1),
    tenant_id: TENANT,
    asset_id: uuid(NS.asset, w.asset + 1),
    priority: w.priority,
    description: w.description,
    status: w.status,
    labor_cost: w.labor,
    parts_cost: w.parts,
    downtime_hours: w.downtime,
    opened_by: MANAGER,
    opened_at: ts(opened, 8),
    closed_at: done ? ts(Math.max(opened - intBetween(2, 20), 1), 17) : null,
    created_at: ts(opened, 8),
  };
});

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORIES = [
  {
    code: "suplementacao",
    label: "Suplementação mineral e ração",
    low: 18000,
    high: 42000,
    capex: "opex",
    counterparties: ["Nutripasto Vale do Paraíba", "Cooperativa Agropecuária de Cunha"],
  },
  {
    code: "sanidade",
    label: "Sanidade e medicamentos",
    low: 4000,
    high: 16000,
    capex: "opex",
    counterparties: ["Distribuidora Agroserra"],
  },
  {
    code: "mao_de_obra",
    label: "Mão de obra e encargos",
    low: 26000,
    high: 31000,
    capex: "opex",
    counterparties: ["Folha de pagamento"],
  },
  {
    code: "pastagem",
    label: "Formação e adubação de pastagem",
    low: 0,
    high: 68000,
    capex: "opex",
    counterparties: ["Cooperativa Agropecuária de Cunha", "Mineradora Serra Nova"],
  },
  {
    code: "combustivel",
    label: "Combustível e lubrificantes",
    low: 3200,
    high: 9800,
    capex: "opex",
    counterparties: ["Posto Serra da Bocaina"],
  },
  {
    code: "reproducao",
    label: "Reprodução e genética",
    low: 0,
    high: 34000,
    capex: "opex",
    counterparties: ["Central Genética Sudeste"],
  },
  {
    code: "manutencao",
    label: "Manutenção de máquinas e benfeitorias",
    low: 1200,
    high: 14000,
    capex: "opex",
    counterparties: ["Oficina Agrícola Cunha", "Casa do Produtor Cunha"],
  },
  {
    code: "energia",
    label: "Energia elétrica e comunicação",
    low: 1800,
    high: 3600,
    capex: "opex",
    counterparties: ["Concessionária de energia"],
  },
  {
    code: "arrendamento",
    label: "Arrendamento do retiro",
    low: 9000,
    high: 9000,
    capex: "opex",
    counterparties: ["Arrendamento Paraitinga"],
  },
  {
    code: "impostos",
    label: "Impostos e taxas rurais",
    low: 900,
    high: 7400,
    capex: "opex",
    counterparties: ["Receita e taxas"],
  },
  {
    code: "benfeitorias",
    label: "Benfeitorias e cercas",
    low: 0,
    high: 52000,
    capex: "capex",
    counterparties: ["Casa do Produtor Cunha"],
  },
  {
    code: "maquinas",
    label: "Máquinas e equipamentos",
    low: 0,
    high: 96000,
    capex: "capex",
    counterparties: ["Revenda de Máquinas Vale"],
  },
];

const REVENUE_CATEGORIES = [
  {
    code: "venda_bezerros",
    label: "Venda de bezerros desmamados",
    low: 0,
    high: 210000,
    counterparties: ["Frigorífico Vale do Paraíba", "Comprador de recria"],
  },
  {
    code: "venda_boi_gordo",
    label: "Venda de boi gordo",
    low: 0,
    high: 340000,
    counterparties: ["Frigorífico Vale do Paraíba"],
  },
  {
    code: "venda_matrizes",
    label: "Venda de matrizes de descarte",
    low: 0,
    high: 96000,
    counterparties: ["Leilão Regional Cunha"],
  },
  {
    code: "venda_genetica",
    label: "Venda de reprodutores e genética",
    low: 0,
    high: 128000,
    counterparties: ["Leilão Regional Cunha", "Cabanha parceira"],
  },
];

const entries = [];
const allocations = [];
const budgets = [];

for (let m = 13; m >= 0; m -= 1) {
  const period = monthStart(m);
  const daysBefore = Math.round((ANCHOR - Date.parse(`${period}T15:00:00Z`)) / DAY);
  for (const cat of EXPENSE_CATEGORIES) {
    // Seasonal categories are zero in some months; that is what a real ledger
    // looks like and it makes the budget-vs-actual view meaningful.
    const seasonal = cat.low === 0;
    if (seasonal && chance(0.55)) {
      budgets.push({ period, category: cat.code, planned: Math.round(cat.high * 0.35) });
      continue;
    }
    const amount = Math.round(between(Math.max(cat.low, cat.high * 0.25), cat.high));
    const farmId = chance(0.72) ? F1 : F2;
    const entryId = uuid(NS.entry, entries.length + 1);
    const occurredAt = ts(Math.max(daysBefore - intBetween(0, 25), 1), 10);
    entries.push({
      id: entryId,
      tenant_id: TENANT,
      farm_id: farmId,
      entry_type: "expense",
      category: cat.code,
      counterparty: pick(cat.counterparties),
      amount_minor: amount * 100,
      currency: "BRL",
      capex_opex: cat.capex,
      reverses_entry_id: null,
      occurred_at: occurredAt,
      recorded_at: occurredAt,
      evidence: json({
        documentType: "nota_fiscal",
        reference: `NF-${intBetween(100000, 999999)}`,
      }),
      event_id: appendEvent({
        eventType: "finance.expense_recorded.v1",
        aggregateType: "financial_entry",
        aggregateId: entryId,
        farmId,
        occurredAt,
        actorId: FINANCE,
        payload: { category: cat.code, amountMinor: amount * 100, currency: "BRL" },
      }),
    });
    // Allocation to the cost object the spend actually belongs to.
    const lot = openLots[Math.floor(rand() * openLots.length)];
    allocations.push({
      id: uuid(NS.allocation, allocations.length + 1),
      tenant_id: TENANT,
      entry_id: entryId,
      dimension: chance(0.6) ? "lot" : "farm",
      target_id: chance(0.6) ? lot.id : farmId,
      target_ref: null,
      allocated_minor: amount * 100,
      allocation_rule_version: "v1",
      created_at: occurredAt,
    });
    budgets.push({ period, category: cat.code, planned: Math.round(cat.high * 0.8) });
  }
}

// A reversal: an expense booked to the wrong category, corrected by a
// compensating entry rather than an edit (constitution invariant 2).
const reversedTarget = entries[6];
if (reversedTarget) {
  const reversalId = uuid(NS.entry, entries.length + 1);
  entries.push({
    id: reversalId,
    tenant_id: TENANT,
    farm_id: reversedTarget.farm_id,
    entry_type: "expense",
    category: reversedTarget.category,
    counterparty: reversedTarget.counterparty,
    amount_minor: reversedTarget.amount_minor,
    currency: "BRL",
    capex_opex: reversedTarget.capex_opex,
    reverses_entry_id: reversedTarget.id,
    occurred_at: ts(96, 11),
    recorded_at: ts(96, 11),
    evidence: json({
      documentType: "estorno",
      reason: "Lançamento classificado na categoria errada; estornado e relançado.",
    }),
    event_id: appendEvent({
      eventType: "finance.expense_reversed.v1",
      aggregateType: "financial_entry",
      aggregateId: reversalId,
      farmId: reversedTarget.farm_id,
      occurredAt: ts(96, 11),
      actorId: FINANCE,
      payload: { reversesEntryId: reversedTarget.id },
    }),
  });
}

// Revenue, and the sales that back it.
const sales = [];
const soldAnimals = byGroup("vendido");
const saleBatches = [
  {
    animals: soldAnimals.slice(0, 9),
    days: 52,
    category: "venda_boi_gordo",
    counterparty: "Frigorífico Vale do Paraíba",
    basis: "arroba",
  },
  {
    animals: soldAnimals.slice(9, 16),
    days: 168,
    category: "venda_bezerros",
    counterparty: "Comprador de recria",
    basis: "peso_vivo",
  },
];

for (const batch of saleBatches) {
  if (batch.animals.length === 0) continue;
  const entryId = uuid(NS.entry, entries.length + 1);
  let gross = 0;
  const lines = [];
  for (const animal of batch.animals) {
    const kg = weightAt(animal, batch.days) ?? 420;
    // Carcass yield ~53%; @ price levels plausible for the region.
    const arrobas = (kg * 0.53) / 15;
    const perArroba = between(310, 348);
    const grossMinor = Math.round(
      (batch.basis === "arroba" ? arrobas * perArroba : kg * between(11.5, 13.4)) * 100,
    );
    const deductions = Math.round(grossMinor * between(0.005, 0.018));
    const freight = Math.round(grossMinor * between(0.012, 0.025));
    gross += grossMinor;
    lines.push({ animal, kg, grossMinor, deductions, freight, perArroba });
  }
  const occurredAt = ts(batch.days, 15);
  entries.push({
    id: entryId,
    tenant_id: TENANT,
    farm_id: F2,
    entry_type: "revenue",
    category: batch.category,
    counterparty: batch.counterparty,
    amount_minor: gross,
    currency: "BRL",
    capex_opex: null,
    reverses_entry_id: null,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    evidence: json({
      documentType: "nota_fiscal_produtor",
      reference: `NFP-${intBetween(10000, 99999)}`,
    }),
    event_id: appendEvent({
      eventType: "finance.revenue_recorded.v1",
      aggregateType: "financial_entry",
      aggregateId: entryId,
      farmId: F2,
      occurredAt,
      actorId: FINANCE,
      payload: { category: batch.category, amountMinor: gross, currency: "BRL" },
      publish: true,
    }),
  });
  allocations.push({
    id: uuid(NS.allocation, allocations.length + 1),
    tenant_id: TENANT,
    entry_id: entryId,
    dimension: "lot",
    target_id: LOTS.find((l) => l.key === "vendido").id,
    target_ref: null,
    allocated_minor: gross,
    allocation_rule_version: "v1",
    created_at: occurredAt,
  });
  for (const line of lines) {
    sales.push({
      id: uuid(NS.sale, sales.length + 1),
      tenant_id: TENANT,
      entry_id: entryId,
      animal_id: line.animal.id,
      lot_id: LOTS.find((l) => l.key === "vendido").id,
      weight_kg: line.kg,
      price_basis: batch.basis,
      gross_minor: line.grossMinor,
      deductions_minor: line.deductions,
      freight_minor: line.freight,
      net_receipt_minor: line.grossMinor - line.deductions - line.freight,
      currency: "BRL",
      sold_at: occurredAt,
      event_id: appendEvent({
        eventType: "commerce.animal_sold.v1",
        aggregateType: "animal",
        aggregateId: line.animal.id,
        farmId: line.animal.farm_id,
        occurredAt,
        actorId: FINANCE,
        payload: {
          visualId: line.animal.visual_id,
          weightKg: line.kg,
          grossMinor: line.grossMinor,
        },
        publish: batch.days < 90,
      }),
    });
  }
}

// One cull-cow revenue line with no per-animal sale rows, so the ledger is not
// uniformly shaped.
{
  const entryId = uuid(NS.entry, entries.length + 1);
  const amount = 8640000;
  entries.push({
    id: entryId,
    tenant_id: TENANT,
    farm_id: F1,
    entry_type: "revenue",
    category: "venda_matrizes",
    counterparty: "Leilão Regional Cunha",
    amount_minor: amount,
    currency: "BRL",
    capex_opex: null,
    reverses_entry_id: null,
    occurred_at: ts(214, 16),
    recorded_at: ts(214, 16),
    evidence: json({ documentType: "mapa_de_leilao", reference: "LOTE-118" }),
    event_id: appendEvent({
      eventType: "finance.revenue_recorded.v1",
      aggregateType: "financial_entry",
      aggregateId: entryId,
      farmId: F1,
      occurredAt: ts(214, 16),
      actorId: FINANCE,
      payload: { category: "venda_matrizes", amountMinor: amount, currency: "BRL" },
    }),
  });
}

// Budgets: one planned figure per category per month, deduplicated on the
// (tenant, farm, month, category) key the table enforces.
const budgetRows = [];
const budgetSeen = new Set();
for (const b of budgets) {
  const key = `${b.period}|${b.category}`;
  if (budgetSeen.has(key)) continue;
  budgetSeen.add(key);
  budgetRows.push({
    id: uuid(NS.budget, budgetRows.length + 1),
    tenant_id: TENANT,
    farm_id: null, // tenant-wide plan; actuals are booked per farm
    period_month: b.period,
    category: b.category,
    planned_minor: b.planned * 100,
    currency: "BRL",
    created_at: ts(400),
  });
}
for (const cat of REVENUE_CATEGORIES) {
  for (let m = 13; m >= 0; m -= 1) {
    const key = `${monthStart(m)}|${cat.code}`;
    if (budgetSeen.has(key)) continue;
    budgetSeen.add(key);
    budgetRows.push({
      id: uuid(NS.budget, budgetRows.length + 1),
      tenant_id: TENANT,
      farm_id: null,
      period_month: monthStart(m),
      category: cat.code,
      planned_minor: Math.round(cat.high * 0.42) * 100,
      currency: "BRL",
      created_at: ts(400),
    });
  }
}

// ---------------------------------------------------------------------------
// Tasks and alerts
// ---------------------------------------------------------------------------

const tasks = [];
function addTask(sourceRule, taskType, dueDays, detail, extra = {}) {
  tasks.push({
    id: uuid(NS.task, tasks.length + 1),
    tenant_id: TENANT,
    farm_id: extra.farmId ?? F1,
    animal_id: extra.animalId ?? null,
    lot_id: extra.lotId ?? null,
    source_rule: sourceRule,
    task_type: taskType,
    due_at: ts(dueDays, 8),
    status: extra.status ?? (dueDays > 0 ? "overdue" : "pending"),
    assigned_to: extra.assignedTo ?? TECH,
    detail: json(detail),
    created_at: ts(dueDays + intBetween(5, 30), 8),
    completed_at: extra.status === "done" ? ts(Math.max(dueDays - 1, -1), 16) : null,
  });
}

// Pregnancy re-checks for every positive diagnosis still short of confirmation.
pregnancyChecks
  .filter((c) => c.result === "positive")
  .slice(0, 14)
  .forEach((check, i) => {
    const dam = animals.find((a) => a.id === check.dam_id);
    addTask(
      "reproduction.confirm_pregnancy_90d",
      "pregnancy_check",
      -(8 + i * 3),
      { visualId: dam.visual_id, method: "ultrasound", stage: "confirmação 90 dias" },
      { animalId: dam.id, farmId: dam.farm_id, assignedTo: VET },
    );
  });

// Weaning for the calves reaching 210 days.
[...byGroup("bezerra"), ...byGroup("bezerro")]
  .filter((c) => c._age > 150 && c._age < 240)
  .slice(0, 12)
  .forEach((calf, i) => {
    addTask(
      "herd.wean_at_210d",
      "weaning",
      210 - calf._age - i,
      { visualId: calf.visual_id, ageDays: calf._age },
      {
        animalId: calf.id,
        farmId: calf.farm_id,
        lotId: LOTS.find((l) => l.key === "cria").id,
      },
    );
  });

// Booster doses coming due.
treatments
  .filter((t) => t.kind === "vaccination")
  .slice(0, 10)
  .forEach((t, i) => {
    const animal = animals.find((a) => a.id === t.animal_id);
    addTask(
      "health.annual_booster",
      "vaccination",
      -(4 + i * 6),
      { visualId: animal.visual_id, productName: t.product_name },
      { animalId: animal.id, farmId: animal.farm_id, assignedTo: VET },
    );
  });

addTask(
  "assets.calibration_due",
  "calibration",
  12,
  {
    asset: "Balança de brete — Retiro",
    intervalDays: 365,
  },
  { farmId: F2, assignedTo: MANAGER },
);
addTask(
  "inventory.below_reorder",
  "purchase",
  3,
  {
    item: "Sal mineral proteinado 30%",
    reorderLevel: 1500,
  },
  { assignedTo: MANAGER },
);
addTask(
  "grazing.rotation_due",
  "paddock_move",
  -2,
  {
    lot: "Engorda Safra 2025",
    reason: "Disponibilidade abaixo de 1.500 kg MS/ha.",
  },
  { lotId: LOTS.find((l) => l.key === "engorda").id, farmId: F2, assignedTo: MANAGER },
);
addTask(
  "herd.weighing_round",
  "weighing",
  -9,
  {
    lot: "Núcleo Genético Brangus 2026",
    expected: LOTS.find((l) => l.key === "nucleo").members.length,
  },
  { lotId: LOTS.find((l) => l.key === "nucleo").id },
);
addTask(
  "health.quarantine_release",
  "health_check",
  -10,
  {
    lot: "Quarentena de Entrada",
    tests: ["brucelose", "tuberculose"],
  },
  { lotId: LOTS.find((l) => l.key === "quarentena").id, assignedTo: VET },
);
addTask(
  "herd.weighing_round",
  "weighing",
  41,
  {
    lot: "Cria — Bezerrada 2025/2026",
    expected: LOTS.find((l) => l.key === "cria").members.length,
  },
  { lotId: LOTS.find((l) => l.key === "cria").id, status: "done" },
);
addTask(
  "finance.month_close",
  "bookkeeping",
  25,
  {
    period: monthStart(1),
  },
  { assignedTo: FINANCE, status: "done" },
);
addTask(
  "grazing.assessment_due",
  "pasture_assessment",
  6,
  {
    paddock: "Cafundó",
  },
  { status: "cancelled" },
);

const alerts = [];
function addAlert(type, severity, dedupe, message, evidence, extra = {}) {
  alerts.push({
    id: uuid(NS.alert, alerts.length + 1),
    tenant_id: TENANT,
    farm_id: extra.farmId ?? F1,
    animal_id: extra.animalId ?? null,
    alert_type: type,
    severity,
    dedupe_key: dedupe,
    message,
    evidence: json(evidence),
    status: extra.status ?? "open",
    acknowledged_by: extra.status && extra.status !== "open" ? MANAGER : null,
    acknowledged_at:
      extra.status && extra.status !== "open" ? ts(extra.days - 1, 9) : null,
    resolved_at: extra.status === "resolved" ? ts(Math.max(extra.days - 3, 1), 15) : null,
    created_at: ts(extra.days ?? 5, 6),
  });
}

// One alert per animal: the dedupe key is uniquely indexed while the alert is
// unresolved, which is exactly the point — a recurring condition is one alert.
const seenWithdrawal = new Set();
const activeWithdrawals = restrictions.filter(
  (r) => r.status === "active" && r.restriction_type === "withdrawal",
);
activeWithdrawals
  .filter((r) => {
    if (seenWithdrawal.has(r.animal_id)) return false;
    seenWithdrawal.add(r.animal_id);
    return true;
  })
  .slice(0, 9)
  .forEach((r, i) => {
    const animal = animals.find((a) => a.id === r.animal_id);
    addAlert(
      "health.withdrawal_active",
      "warning",
      `withdrawal:${animal.visual_id}`,
      `Carência ativa em ${animal.visual_id} — venda bloqueada até ${r.valid_to.slice(0, 10)}.`,
      {
        visualId: animal.visual_id,
        restrictionId: r.id,
        clearedAfter: r.valid_to.slice(0, 10),
      },
      { animalId: animal.id, farmId: animal.farm_id, days: 2 + i },
    );
  });

addAlert(
  "assets.calibration_overdue",
  "critical",
  "calibration:TT-S3-44192",
  "Balança eletrônica de curral com calibração vencida há 35 dias — pesagens seguem sendo aceitas, mas ficam marcadas.",
  { assetSerial: "TT-S3-44192", overdueDays: 35 },
  { days: 4 },
);
addAlert(
  "inventory.below_reorder",
  "warning",
  "stock:sal-mineral",
  "Sal mineral proteinado abaixo do ponto de pedido com a seca em curso.",
  { item: "Sal mineral proteinado 30%", reorderLevel: 1500 },
  { days: 3 },
);
addAlert(
  "grazing.availability_low",
  "warning",
  "pasture:cafundo",
  "Cafundó com 1.180 kg MS/ha — abaixo do piso de saída do lote.",
  { paddock: "Cafundó", availabilityKgDmHa: 1180, floor: 1500 },
  { days: 6 },
);
addAlert(
  "herd.weight_loss",
  "critical",
  `weightloss:${activeHerd[3].visual_id}`,
  `${activeHerd[3].visual_id} perdeu peso entre duas pesagens consecutivas — avaliar sanidade.`,
  { visualId: activeHerd[3].visual_id, deltaKg: -14.5 },
  { animalId: activeHerd[3].id, days: 8 },
);
addAlert(
  "reproduction.check_overdue",
  "info",
  "repro:confirm-90d",
  "14 matrizes com confirmação de prenhez de 90 dias em atraso.",
  { count: 14 },
  { days: 5, status: "acknowledged" },
);
addAlert(
  "device.unresolved_reads",
  "info",
  "device:unresolved",
  "Leituras de balança sem brinco resolvido aguardando conferência no curral.",
  {
    pending: observations.filter((o) => o.resolution_status === "pending_resolution")
      .length,
  },
  { days: 9, status: "acknowledged" },
);
addAlert(
  "health.case_open",
  "warning",
  "health:pneumonia",
  "Caso clínico de broncopneumonia aberto há mais de 5 dias sem desfecho registrado.",
  { diagnosis: "Broncopneumonia em bezerro desmamado" },
  { days: 14, status: "resolved" },
);
addAlert(
  "grazing.overstay",
  "info",
  "grazing:overstay-engorda",
  "Lote Engorda Safra 2025 há 41 dias no mesmo piquete.",
  { lot: "Engorda Safra 2025", days: 41 },
  { days: 11, farmId: F2, status: "resolved" },
);

// ---------------------------------------------------------------------------
// Governed AI
// ---------------------------------------------------------------------------

const recommendations = [];
const aiAudit = [];

function addRecommendation({
  key,
  params,
  actionCategory,
  action,
  risk,
  confidence,
  status,
  evidence,
  assumptionsKey,
  assumptions,
  text,
  days,
  farmId = F1,
}) {
  const id = uuid(NS.recommendation, recommendations.length + 1);
  recommendations.push({
    id,
    tenant_id: TENANT,
    farm_id: farmId,
    agent_name: "herd-advisor",
    model_provider: "deterministic",
    model_version: "rules-2026.07",
    prompt_version: "v3",
    recommendation_text: text,
    proposed_action_category: actionCategory,
    proposed_action: json(action),
    evidence_event_ids: arr(evidence),
    confidence,
    assumptions,
    risk_class: risk,
    status,
    approved_by: status === "approved" || status === "executed" ? MANAGER : null,
    approved_at: status === "approved" || status === "executed" ? ts(days - 1, 14) : null,
    rejected_reason:
      status === "rejected"
        ? "Animal já estava programado para descarte na próxima boiada."
        : null,
    expires_at: ts(days - 30, 12),
    created_at: ts(days, 6),
    event_id: null,
    recommendation_key: key,
    recommendation_params: json(params),
    assumptions_key: assumptionsKey,
  });
  aiAudit.push({
    id: uuid(NS.aiAudit, aiAudit.length + 1),
    tenant_id: TENANT,
    recommendation_id: id,
    agent_name: "herd-advisor",
    action: "recommendation.created",
    outcome: "created",
    detail: json({ riskClass: risk, confidence }),
    actor_type: "service",
    actor_id: "ai-orchestrator",
    recorded_at: ts(days, 6),
  });
  if (status === "approved" || status === "executed") {
    aiAudit.push({
      id: uuid(NS.aiAudit, aiAudit.length + 1),
      tenant_id: TENANT,
      recommendation_id: id,
      agent_name: "herd-advisor",
      action: "recommendation.approved",
      outcome: "approved",
      detail: json({ approvedBy: "farm_manager" }),
      actor_type: "user",
      actor_id: MANAGER,
      recorded_at: ts(days - 1, 14),
    });
  }
  if (status === "executed") {
    aiAudit.push({
      id: uuid(NS.aiAudit, aiAudit.length + 1),
      tenant_id: TENANT,
      recommendation_id: id,
      agent_name: "herd-advisor",
      action: "recommendation.executed",
      outcome: "executed",
      detail: json({ executedBy: "farm_manager" }),
      actor_type: "user",
      actor_id: MANAGER,
      recorded_at: ts(days - 1, 15),
    });
  }
  if (status === "rejected") {
    aiAudit.push({
      id: uuid(NS.aiAudit, aiAudit.length + 1),
      tenant_id: TENANT,
      recommendation_id: id,
      agent_name: "herd-advisor",
      action: "recommendation.rejected",
      outcome: "rejected",
      detail: json({ reason: "already_scheduled_for_cull" }),
      actor_type: "user",
      actor_id: MANAGER,
      recorded_at: ts(days - 2, 11),
    });
  }
}

const evidenceIds = events.slice(-40).map((e) => e.event_id);
const lightAnimals = [...activeHerd]
  .filter((a) => a._group === "garrote" || a._group === "novilha")
  .slice(0, 3);

lightAnimals.forEach((animal, i) => {
  const kg = weightAt(animal, 6) ?? weightAt(animal, 26) ?? 300;
  addRecommendation({
    key: "rec.msg.lowWeight",
    params: { visualId: animal.visual_id, weightKg: Math.round(kg) },
    actionCategory: "review_animal",
    action: { animalId: animal.id, visualId: animal.visual_id, weightKg: Math.round(kg) },
    risk: "low",
    confidence: Number(between(0.62, 0.88).toFixed(2)),
    status: i === 0 ? "pending" : i === 1 ? "approved" : "rejected",
    evidence: evidenceIds.slice(i * 2, i * 2 + 3),
    assumptionsKey: "rec.assume.recentWeights",
    assumptions: "Baseado nas pesagens elegíveis mais recentes.",
    text: `Revisar o animal ${animal.visual_id} (${Math.round(kg)} kg) — peso abaixo do esperado; verificar sanidade e nutrição.`,
    days: 4 + i * 3,
    farmId: animal.farm_id,
  });
});

if (activeWithdrawals.length > 0) {
  const r = activeWithdrawals[0];
  const animal = animals.find((a) => a.id === r.animal_id);
  addRecommendation({
    key: "rec.msg.withdrawalActiveUntil",
    params: { visualId: animal.visual_id, clearedAfter: r.valid_to.slice(0, 10) },
    // A prohibited autonomous action: the platform may recommend it, never do it.
    actionCategory: "block_sale",
    action: {
      animalId: animal.id,
      visualId: animal.visual_id,
      clearedAfter: r.valid_to.slice(0, 10),
    },
    risk: "high",
    confidence: 0.97,
    status: "pending",
    evidence: evidenceIds.slice(6, 9),
    assumptionsKey: "rec.assume.withdrawalRestriction",
    assumptions: "Restrição de carência ativa vinculada a um tratamento.",
    text: `Não vender o animal ${animal.visual_id} — carência ativa até ${r.valid_to.slice(0, 10)}; conferir a liberação antes de qualquer venda.`,
    days: 2,
    farmId: animal.farm_id,
  });
  aiAudit.push({
    id: uuid(NS.aiAudit, aiAudit.length + 1),
    tenant_id: TENANT,
    recommendation_id: recommendations[recommendations.length - 1].id,
    agent_name: "herd-advisor",
    action: "autonomous_execution",
    outcome: "blocked",
    detail: json({
      reason: "prohibited_action_category",
      category: "block_sale",
      policy: "high-impact actions require human approval",
    }),
    actor_type: "service",
    actor_id: "ai-orchestrator",
    recorded_at: ts(2, 6, 5),
  });
}

const openDams = pregnancyChecks.filter((c) => c.result === "negative").slice(0, 2);
openDams.forEach((check, i) => {
  const dam = animals.find((a) => a.id === check.dam_id);
  addRecommendation({
    key: "rec.msg.reproductionGap",
    params: { visualId: dam.visual_id },
    actionCategory: "schedule_service",
    action: { animalId: dam.id, visualId: dam.visual_id },
    risk: "medium",
    confidence: Number(between(0.55, 0.75).toFixed(2)),
    status: i === 0 ? "pending" : "executed",
    evidence: evidenceIds.slice(10 + i * 2, 13 + i * 2),
    assumptionsKey: null,
    assumptions:
      "Diagnóstico negativo na estação corrente e sem serviço posterior registrado.",
    text: `Avaliar a aptidão reprodutiva da matriz ${dam.visual_id} e agendar cobertura.`,
    days: 7 + i * 4,
    farmId: dam.farm_id,
  });
});

const neverWeighed = activeHerd.filter(
  (a) => !weights.some((w) => w.animal_id === a.id),
)[0];
if (neverWeighed) {
  addRecommendation({
    key: "rec.msg.missingWeight",
    params: { visualId: neverWeighed.visual_id },
    actionCategory: "schedule_weighing",
    action: { animalId: neverWeighed.id, visualId: neverWeighed.visual_id },
    risk: "low",
    confidence: 0.9,
    status: "pending",
    evidence: evidenceIds.slice(14, 16),
    assumptionsKey: null,
    assumptions: "Nenhuma pesagem elegível encontrada para o animal.",
    text: `Agendar pesagem do animal ${neverWeighed.visual_id} — nenhuma pesagem registrada.`,
    days: 3,
    farmId: neverWeighed.farm_id,
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

const connectors = [
  {
    id: uuid(NS.connector, 1),
    tenant_id: TENANT,
    connector_type: "scale",
    name: "Tru-Test S3 — curral da sede",
    config: json({
      gatewayId: "gw-curral-sede",
      protocol: "tru-test-serial-v2",
      unit: "kg",
    }),
    status: "active",
    created_at: ts(520),
    event_id: null,
  },
  {
    id: uuid(NS.connector, 2),
    tenant_id: TENANT,
    connector_type: "rfid_reader",
    name: "Allflex RS420 — bastão",
    config: json({ gatewayId: "gw-curral-sede", standard: "ISO 11784/11785" }),
    status: "active",
    created_at: ts(520),
    event_id: null,
  },
  {
    id: uuid(NS.connector, 3),
    tenant_id: TENANT,
    connector_type: "weather",
    name: "Estação meteorológica da sede",
    config: json({
      stationId: "cunha-sede-01",
      variables: ["rain_mm", "temp_c", "rh_pct"],
    }),
    status: "active",
    created_at: ts(300),
    event_id: null,
  },
  {
    id: uuid(NS.connector, 4),
    tenant_id: TENANT,
    connector_type: "erp",
    name: "Exportação contábil mensal",
    config: json({ format: "csv", cadence: "monthly", scope: "financial_entry" }),
    status: "suspended",
    created_at: ts(240),
    event_id: null,
  },
  {
    id: uuid(NS.connector, 5),
    tenant_id: TENANT,
    connector_type: "lab",
    name: "Laboratório de análise de solo",
    config: json({
      provider: "Laboratório Agroanálise",
      sampleTypes: ["solo", "forragem"],
    }),
    status: "error",
    created_at: ts(180),
    event_id: null,
  },
];

// The secret is a placeholder, not a credential: it is never used to sign
// anything and the row exists so the console can render the rotation state.
const webhookSubscriptions = [
  {
    id: uuid(NS.webhook, 1),
    tenant_id: TENANT,
    url: "https://webhook.example.com/saga/herd",
    event_families: arr(["animal", "weighing"]),
    description: "Espelho do rebanho para o painel do escritório.",
    secret: "seed-placeholder-not-a-credential-01",
    secret_previous: null,
    secret_rotated_at: null,
    active: true,
    created_at: ts(300),
    event_id: null,
  },
  {
    id: uuid(NS.webhook, 2),
    tenant_id: TENANT,
    url: "https://webhook.example.com/saga/health",
    event_families: arr(["health", "reproduction"]),
    description: "Aviso de carência e diagnóstico para a veterinária.",
    secret: "seed-placeholder-not-a-credential-02",
    secret_previous: "seed-placeholder-not-a-credential-02-old",
    secret_rotated_at: ts(40),
    active: true,
    created_at: ts(260),
    event_id: null,
  },
  {
    id: uuid(NS.webhook, 3),
    tenant_id: TENANT,
    url: "https://webhook.example.com/saga/finance",
    event_families: arr(["finance", "commerce"]),
    description: "Integração com a contabilidade — desativada durante a migração.",
    secret: "seed-placeholder-not-a-credential-03",
    secret_previous: null,
    secret_rotated_at: null,
    active: false,
    created_at: ts(200),
    event_id: null,
  },
];

const deliveries = [];
const attempts = [];
const publishedEvents = outbox.slice(0, 24);
publishedEvents.forEach((message, i) => {
  const family = message.subject.split(".")[3];
  const subscription =
    family === "animal" || family === "weighing"
      ? webhookSubscriptions[0]
      : webhookSubscriptions[1];
  const source = events.find((e) => e.event_id === message.event_id);
  const outcome = i % 11 === 5 ? "failed" : i % 7 === 3 ? "pending" : "delivered";
  const deliveryId = uuid(NS.delivery, deliveries.length + 1);
  deliveries.push({
    id: deliveryId,
    tenant_id: TENANT,
    subscription_id: subscription.id,
    delivery_id: uuid(NS.delivery, 500 + deliveries.length + 1),
    event_id: message.event_id,
    event_family: family,
    event_type: source.event_type,
    payload: message.envelope,
    status:
      outcome === "failed"
        ? "dead_letter"
        : outcome === "pending"
          ? "pending"
          : "delivered",
    attempts: outcome === "failed" ? 6 : outcome === "pending" ? 1 : 1,
    max_attempts: 6,
    next_attempt_at: source.occurred_at,
    last_status_code: outcome === "failed" ? 503 : outcome === "pending" ? null : 200,
    last_error: outcome === "failed" ? "Upstream returned 503 on every attempt." : null,
    created_at: source.occurred_at,
    delivered_at: outcome === "delivered" ? source.occurred_at : null,
  });
  const attemptCount = outcome === "failed" ? 6 : 1;
  for (let a = 1; a <= attemptCount; a += 1) {
    attempts.push({
      id: uuid(NS.attempt, attempts.length + 1),
      tenant_id: TENANT,
      delivery_id: deliveryId,
      attempt_number: a,
      outcome:
        outcome === "failed"
          ? a === attemptCount
            ? "dead_letter"
            : "retryable_error"
          : outcome === "pending"
            ? "retryable_error"
            : "delivered",
      status_code: outcome === "failed" ? 503 : outcome === "pending" ? 504 : 200,
      error: outcome === "delivered" ? null : "Upstream unavailable",
      recorded_at: source.occurred_at,
    });
  }
});

// ---------------------------------------------------------------------------
// Exports and staged imports
// ---------------------------------------------------------------------------

const traceabilityAnimal = activeHerd[0];
const exportJobs = [
  {
    id: uuid(NS.exportJob, 1),
    tenant_id: TENANT,
    requested_by: MANAGER,
    export_type: "animal_traceability_packet",
    format: "json",
    params: json({
      animalId: traceabilityAnimal.id,
      visualId: traceabilityAnimal.visual_id,
    }),
    status: "completed",
    result_content: null,
    result_ref: "export/jq-farm/traceability-packet-001.json",
    result_checksum:
      "sha256:0000000000000000000000000000000000000000000000000000000000000001",
    byte_size: 48213,
    error: null,
    expires_at: ts(-5, 12),
    created_at: ts(9, 10),
    started_at: ts(9, 10, 1),
    completed_at: ts(9, 10, 3),
    event_id: null,
  },
  {
    id: uuid(NS.exportJob, 2),
    tenant_id: TENANT,
    requested_by: FINANCE,
    export_type: "finance_ledger",
    format: "csv",
    params: json({ from: monthStart(3), to: monthStart(0) }),
    status: "completed",
    result_content: null,
    result_ref: "export/jq-farm/finance-ledger-2026q2.csv",
    result_checksum:
      "sha256:0000000000000000000000000000000000000000000000000000000000000002",
    byte_size: 19044,
    error: null,
    expires_at: ts(-3, 12),
    created_at: ts(4, 15),
    started_at: ts(4, 15, 1),
    completed_at: ts(4, 15, 2),
    event_id: null,
  },
  {
    id: uuid(NS.exportJob, 3),
    tenant_id: TENANT,
    requested_by: GENETICS,
    export_type: "herd_weights",
    format: "xlsx",
    params: json({ lotId: LOTS.find((l) => l.key === "nucleo").id }),
    status: "running",
    result_content: null,
    result_ref: null,
    result_checksum: null,
    byte_size: null,
    error: null,
    expires_at: ts(-7, 12),
    created_at: ts(0, 11),
    started_at: ts(0, 11, 1),
    completed_at: null,
    event_id: null,
  },
  {
    id: uuid(NS.exportJob, 4),
    tenant_id: TENANT,
    requested_by: MANAGER,
    export_type: "animal_inventory",
    format: "geojson",
    params: json({ farmId: F1 }),
    status: "failed",
    result_content: null,
    result_ref: null,
    result_checksum: null,
    byte_size: null,
    error: "Um piquete não tem geometria registrada; o pacote não pôde ser fechado.",
    expires_at: ts(-1, 12),
    created_at: ts(21, 9),
    started_at: ts(21, 9, 1),
    completed_at: ts(21, 9, 2),
    event_id: null,
  },
  {
    id: uuid(NS.exportJob, 5),
    tenant_id: TENANT,
    requested_by: OWNER,
    export_type: "animal_inventory",
    format: "csv",
    params: json({}),
    status: "expired",
    result_content: null,
    result_ref: "export/jq-farm/inventory-2026-04.csv",
    result_checksum:
      "sha256:0000000000000000000000000000000000000000000000000000000000000003",
    byte_size: 30288,
    error: null,
    expires_at: ts(84, 12),
    created_at: ts(91, 9),
    started_at: ts(91, 9, 1),
    completed_at: ts(91, 9, 2),
    event_id: null,
  },
];

const exportAccessLog = [];
exportJobs.forEach((job, i) => {
  exportAccessLog.push({
    id: uuid(NS.accessLog, exportAccessLog.length + 1),
    tenant_id: TENANT,
    export_job_id: job.id,
    action: "requested",
    actor_type: "user",
    actor_id: job.requested_by,
    detail: json({ exportType: job.export_type, format: job.format }),
    recorded_at: job.created_at,
  });
  if (job.status === "completed" || job.status === "expired") {
    exportAccessLog.push({
      id: uuid(NS.accessLog, exportAccessLog.length + 1),
      tenant_id: TENANT,
      export_job_id: job.id,
      action: "completed",
      actor_type: "service",
      actor_id: "export-worker",
      detail: json({ byteSize: job.byte_size }),
      recorded_at: job.completed_at,
    });
  }
  if (job.status === "completed") {
    exportAccessLog.push({
      id: uuid(NS.accessLog, exportAccessLog.length + 1),
      tenant_id: TENANT,
      export_job_id: job.id,
      action: "downloaded",
      actor_type: "user",
      actor_id: job.requested_by,
      detail: json({}),
      recorded_at: job.completed_at,
    });
  }
  if (job.status === "expired") {
    exportAccessLog.push({
      id: uuid(NS.accessLog, exportAccessLog.length + 1),
      tenant_id: TENANT,
      export_job_id: job.id,
      action: "denied_expired",
      actor_type: "user",
      actor_id: job.requested_by,
      detail: json({ expiresAt: job.expires_at }),
      recorded_at: ts(70, 10),
    });
  }
  if (job.status === "failed") {
    exportAccessLog.push({
      id: uuid(NS.accessLog, exportAccessLog.length + 1),
      tenant_id: TENANT,
      export_job_id: job.id,
      action: "failed",
      actor_type: "service",
      actor_id: "export-worker",
      detail: json({ error: job.error }),
      recorded_at: job.completed_at,
    });
  }
  void i;
});

// A staged import that has been executed, plus one still sitting at validation
// with rows the operator has to fix — the workflow §27 describes.
const IMPORT_HEADER = "brinco_visual,sexo,nascimento,raca,rfid";
const importedRows = [
  ["JQ-9001", "femea", "2025-03-14", "BRANGUS", "982000000900001", "valid", "created"],
  ["JQ-9002", "femea", "2025-03-19", "BRANGUS", "982000000900002", "valid", "created"],
  ["JQ-9003", "macho", "2025-04-02", "BRANGUS", "982000000900003", "valid", "created"],
  ["JQ-9004", "macho", "2025-04-08", "BRANGUS", "982000000900004", "valid", "created"],
  ["JQ-9005", "femea", "2025-04-21", "BRANGUS", "982000000900005", "valid", "created"],
];
const pendingRows = [
  [
    "JQ-9101",
    "femea",
    "2026-02-11",
    "BRANGUS",
    "982000000910001",
    "valid",
    "pending",
    null,
  ],
  [
    "JQ-9102",
    "fêmea",
    "11/02/2026",
    "BRANGUS",
    "982000000910002",
    "invalid",
    "pending",
    "Data de nascimento fora do formato ISO 8601.",
  ],
  [
    "JQ-9103",
    "macho",
    "2026-02-15",
    "BRANGUS",
    "982000000910001",
    "invalid",
    "pending",
    "RFID duplicado dentro do próprio arquivo.",
  ],
  [
    "JQ-9104",
    "macho",
    "2026-02-18",
    "BRANGUS",
    "",
    "invalid",
    "pending",
    "RFID ausente.",
  ],
  [
    "JQ-9105",
    "femea",
    "2026-02-19",
    "BRANGUS",
    "982000000910005",
    "duplicate",
    "skipped",
    "Já existe um animal ativo com este RFID.",
  ],
  [
    "JQ-9106",
    "femea",
    "2026-02-22",
    "BRANGUS",
    "982000000910006",
    "valid",
    "pending",
    null,
  ],
];

const importJobs = [
  {
    id: uuid(NS.importJob, 1),
    tenant_id: TENANT,
    farm_id: F1,
    import_type: "animals",
    status: "reconciled",
    filename: "bezerros-safra-2025.csv",
    raw_content: [
      IMPORT_HEADER,
      ...importedRows.map((r) => r.slice(0, 5).join(",")),
    ].join("\n"),
    raw_checksum:
      "sha256:0000000000000000000000000000000000000000000000000000000000000011",
    raw_format: "csv",
    mapping: json({
      brinco_visual: "visualId",
      sexo: "sex",
      nascimento: "birthDate",
      raca: "breedCode",
      rfid: "identifiers.rfid",
    }),
    total_rows: importedRows.length,
    valid_rows: importedRows.length,
    invalid_rows: 0,
    duplicate_rows: 0,
    executed_rows: importedRows.length,
    failed_rows: 0,
    created_by: TECH,
    created_at: ts(148, 14),
    event_id: null,
  },
  {
    id: uuid(NS.importJob, 2),
    tenant_id: TENANT,
    farm_id: F1,
    import_type: "animals",
    status: "validated",
    filename: "entrada-fevereiro-2026.csv",
    raw_content: [IMPORT_HEADER, ...pendingRows.map((r) => r.slice(0, 5).join(","))].join(
      "\n",
    ),
    raw_checksum:
      "sha256:0000000000000000000000000000000000000000000000000000000000000012",
    raw_format: "csv",
    mapping: json({
      brinco_visual: "visualId",
      sexo: "sex",
      nascimento: "birthDate",
      raca: "breedCode",
      rfid: "identifiers.rfid",
    }),
    total_rows: pendingRows.length,
    valid_rows: pendingRows.filter((r) => r[5] === "valid").length,
    invalid_rows: pendingRows.filter((r) => r[5] === "invalid").length,
    duplicate_rows: pendingRows.filter((r) => r[5] === "duplicate").length,
    executed_rows: 0,
    failed_rows: 0,
    created_by: TECH,
    created_at: ts(6, 16),
    event_id: null,
  },
];

const importRows = [];
function addImportRows(jobId, rows, withErrors) {
  rows.forEach((r, i) => {
    importRows.push({
      id: uuid(NS.importRow, importRows.length + 1),
      tenant_id: TENANT,
      import_job_id: jobId,
      row_number: i + 1,
      raw: json({
        brinco_visual: r[0],
        sexo: r[1],
        nascimento: r[2],
        raca: r[3],
        rfid: r[4],
      }),
      mapped:
        r[5] === "invalid"
          ? null
          : json({
              visualId: r[0],
              sex: r[1].startsWith("f") || r[1].startsWith("fê") ? "female" : "male",
              birthDate: r[2],
              breedCode: r[3],
              identifiers: { rfid: r[4] },
            }),
      validation_status: r[5],
      errors: withErrors && r[7] ? json([{ field: "row", reason: r[7] }]) : json([]),
      execution_status: r[6],
      server_id: r[6] === "created" ? uuid(NS.importRow, 900 + i) : null,
      execution_error: null,
    });
  });
}
addImportRows(importJobs[0].id, importedRows, false);
addImportRows(importJobs[1].id, pendingRows, true);

// ---------------------------------------------------------------------------
// Registration events (written last so the ledger reads in dependency order,
// but assigned aggregate_version 1 because they are each animal's first fact)
// ---------------------------------------------------------------------------

const registrationEvents = [];
for (const animal of animals) {
  const eventId = nextEventId();
  registrationEvents.push({
    event_id: eventId,
    tenant_id: TENANT,
    farm_id: animal.farm_id,
    event_type: "animal.animal_registered.v1",
    schema_version: 1,
    aggregate_type: "animal",
    aggregate_id: animal.id,
    aggregate_version: 0, // renumbered below
    occurred_at: animal.created_at,
    recorded_at: animal.created_at,
    actor_type: "user",
    actor_id: TECH,
    source_channel: "web",
    correlation_id: uuid(NS.correlation, 2),
    causation_id: null,
    idempotency_key: `jq-${eventId}`,
    payload: json({
      visualId: animal.visual_id,
      breedCode: animal.breed_code,
      speciesCode: animal.species_code,
      sex: animal.sex,
      birthDate: animal.birth_date,
      birthDatePrecision: animal.birth_date_precision,
      lifecycleStatus: animal.lifecycle_status,
    }),
    metadata: json({
      locale: "pt-BR",
      qualityFlags: ["synthetic_seed"],
      supersedesEventId: null,
    }),
  });
}

// Registration is version 1 for each animal; everything already appended for
// that animal shifts up by one so the sequence stays gapless and ordered.
for (const event of events) {
  if (event.aggregate_type !== "animal") continue;
  event.aggregate_version += 1;
}
for (const event of registrationEvents) {
  event.aggregate_version = 1;
}
const allEvents = [...registrationEvents, ...events].sort((a, b) => {
  if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
  return a.event_id < b.event_id ? -1 : 1;
});

// The animal read model carries the version of its last event, which is what
// optimistic concurrency compares against on the next write.
for (const animal of animals) {
  const version = allEvents.filter(
    (e) => e.aggregate_type === "animal" && e.aggregate_id === animal.id,
  ).length;
  animal.version = version;
}

// ---------------------------------------------------------------------------
// Emission, in foreign-key dependency order
// ---------------------------------------------------------------------------

insert(
  "animal",
  ANIMAL_COLUMNS,
  animals.map((a) => Object.fromEntries(ANIMAL_COLUMNS.map((c) => [c, a[c]]))),
  `Herd: ${animals.length} Brangus across both blocks — bulls, cows, heifers,\n-- steers, the current calf crop, and the animals that left (sold, deceased,\n-- transferred, missing). Identity is stable across every one of those\n-- transitions (constitution invariant 3).`,
);

insert(
  "animal_identifier",
  [
    "id",
    "tenant_id",
    "animal_id",
    "identifier_type",
    "identifier_value",
    "valid_from",
    "valid_to",
    "assigned_by",
    "created_at",
  ],
  identifiers,
  "Identifiers. Breeding stock also carries an official number; the closed\n-- 'legacy' rows are animals that were retagged — the animal did not change.",
);

insert(
  "animal_parentage",
  [
    "id",
    "tenant_id",
    "child_id",
    "parent_id",
    "external_parent_ref",
    "relation",
    "confidence",
    "created_at",
  ],
  parentage,
  "Parentage. AI sires are external references, not rows in this herd.",
);

insert(
  "lot_membership",
  ["id", "tenant_id", "lot_id", "animal_id", "valid_from", "valid_to", "created_at"],
  lotMemberships,
  "Lot membership is time-bounded, so history survives a regrouping.",
);

insert(
  "health_protocol",
  [
    "id",
    "tenant_id",
    "farm_id",
    "name",
    "species_code",
    "applies_to",
    "version",
    "schedule",
    "status",
    "created_at",
  ],
  protocolRows,
  "Health protocols in force on both blocks.",
);

insert(
  "treatment",
  [
    "id",
    "tenant_id",
    "animal_id",
    "protocol_id",
    "kind",
    "product_name",
    "medicine_batch",
    "dose",
    "dose_unit",
    "route",
    "administered_by",
    "administered_at",
    "withdrawal_until",
    "notes",
    "event_id",
    "created_at",
  ],
  treatments,
  "Treatments and vaccinations, each tied to the batch that was used.",
);

insert(
  "animal_restriction",
  [
    "id",
    "tenant_id",
    "animal_id",
    "restriction_type",
    "source_treatment_id",
    "reason",
    "valid_from",
    "valid_to",
    "status",
    "lifted_by",
    "lifted_reason",
    "lifted_at",
    "created_at",
  ],
  restrictions,
  "Restrictions are the enforcement surface: while a withdrawal is active the\n-- animal cannot be cleared for sale. Lifting is recorded, never silent.",
);

insert(
  "health_case",
  [
    "id",
    "tenant_id",
    "animal_id",
    "opened_by",
    "opened_at",
    "symptom",
    "diagnosis",
    "status",
    "outcome",
    "closed_at",
    "created_at",
  ],
  healthCases,
  "Clinical cases, including two still open.",
);

insert(
  "reproduction_service",
  [
    "id",
    "tenant_id",
    "dam_id",
    "method",
    "service_date",
    "bull_id",
    "external_sire_ref",
    "semen_batch",
    "technician_id",
    "notes",
    "event_id",
    "created_at",
  ],
  services,
  "The 2025/2026 breeding station: fixed-time AI on most of the herd, natural\n-- service as the clean-up.",
);

insert(
  "pregnancy_check",
  [
    "id",
    "tenant_id",
    "dam_id",
    "service_id",
    "check_date",
    "method",
    "result",
    "gestation_days_estimate",
    "expected_calving_date",
    "event_id",
    "created_at",
  ],
  pregnancyChecks,
  "Diagnoses at ~35 days, plus the losses picked up on re-check.",
);

insert(
  "calving",
  [
    "id",
    "tenant_id",
    "dam_id",
    "service_id",
    "calving_date",
    "ease",
    "outcome",
    "calf_id",
    "birth_weight_kg",
    "sire_confidence",
    "event_id",
    "created_at",
  ],
  calvings,
  "Calvings from the previous station, linked to the calf where it is alive.",
);

insert(
  "animal_weight",
  [
    "id",
    "tenant_id",
    "animal_id",
    "occurred_at",
    "weight_kg",
    "eligible_for_analytics",
    "quality_flags",
    "source_observation_id",
    "event_id",
    "calculated_at",
  ],
  weights,
  `${WEIGH_ROUNDS.length} weighing rounds over the last year. A few readings are\n-- flagged and excluded from analytics rather than deleted.`,
);

insert(
  "genetic_evaluation",
  [
    "id",
    "tenant_id",
    "animal_id",
    "provider",
    "evaluation_date",
    "trait",
    "value",
    "percentile",
    "reliability",
    "source_file",
    "event_id",
    "imported_at",
  ],
  geneticEvaluations,
  "Breeding values for the nucleus, imported from a summary file.",
);

insert(
  "selection_index",
  [
    "id",
    "tenant_id",
    "name",
    "version",
    "weights",
    "missing_data_behavior",
    "created_at",
  ],
  selectionIndexes,
  "Two selection indexes — terminal and maternal — with explicit weights.",
);

insert(
  "item",
  [
    "id",
    "tenant_id",
    "name",
    "category",
    "unit",
    "supplier",
    "reorder_level",
    "created_at",
  ],
  itemRows,
  "Inventory item master.",
);

insert(
  "item_batch",
  [
    "id",
    "tenant_id",
    "item_id",
    "batch_code",
    "expiration_date",
    "received_at",
    "created_at",
  ],
  batches,
  "Batches carry the expiry that drives the disposal movements below.",
);

insert(
  "stock_movement",
  [
    "id",
    "tenant_id",
    "item_id",
    "batch_id",
    "movement_type",
    "quantity_delta",
    "unit",
    "animal_id",
    "lot_id",
    "paddock_id",
    "work_order_id",
    "reason",
    "occurred_at",
    "recorded_at",
    "event_id",
  ],
  stockMovements,
  "The stock ledger is append-only: a miscount is an adjustment row, not an edit.",
);

insert(
  "asset",
  [
    "id",
    "tenant_id",
    "farm_id",
    "name",
    "asset_type",
    "model",
    "serial",
    "location",
    "status",
    "responsible_id",
    "calibration_valid_until",
    "created_at",
  ],
  assetRows,
  "Assets. One scale is past its calibration date — that is what raises the\n-- critical alert further down.",
);

insert(
  "maintenance_schedule",
  [
    "id",
    "tenant_id",
    "asset_id",
    "kind",
    "interval_days",
    "last_done_at",
    "next_due_at",
    "created_at",
  ],
  maintenanceSchedules,
  "Preventive and calibration schedules.",
);

insert(
  "work_order",
  [
    "id",
    "tenant_id",
    "asset_id",
    "priority",
    "description",
    "status",
    "labor_cost",
    "parts_cost",
    "downtime_hours",
    "opened_by",
    "opened_at",
    "closed_at",
    "created_at",
  ],
  workOrders,
  "Work orders across every status.",
);

insert(
  "financial_entry",
  [
    "id",
    "tenant_id",
    "farm_id",
    "entry_type",
    "category",
    "counterparty",
    "amount_minor",
    "currency",
    "capex_opex",
    "reverses_entry_id",
    "occurred_at",
    "recorded_at",
    "evidence",
    "event_id",
  ],
  entries,
  "14 months of ledger in minor units. One entry reverses another: a mistake is\n-- corrected by a compensating entry, never by rewriting history (invariant 2).",
);

insert(
  "financial_allocation",
  [
    "id",
    "tenant_id",
    "entry_id",
    "dimension",
    "target_id",
    "target_ref",
    "allocated_minor",
    "allocation_rule_version",
    "created_at",
  ],
  allocations,
  "Each entry is allocated to the cost object it belongs to, so lot margin means\n-- something.",
);

insert(
  "sale",
  [
    "id",
    "tenant_id",
    "entry_id",
    "animal_id",
    "lot_id",
    "weight_kg",
    "price_basis",
    "gross_minor",
    "deductions_minor",
    "freight_minor",
    "net_receipt_minor",
    "currency",
    "sold_at",
    "event_id",
  ],
  sales,
  "Sales, priced per arroba or per live kilogram, with deductions and freight\n-- separated from the gross.",
);

insert(
  "budget",
  [
    "id",
    "tenant_id",
    "farm_id",
    "period_month",
    "category",
    "planned_minor",
    "currency",
    "created_at",
  ],
  budgetRows,
  "Monthly plan per category — the counterpart to the actuals above.",
);

insert(
  "task",
  [
    "id",
    "tenant_id",
    "farm_id",
    "animal_id",
    "lot_id",
    "source_rule",
    "task_type",
    "due_at",
    "status",
    "assigned_to",
    "detail",
    "created_at",
    "completed_at",
  ],
  tasks,
  "Tasks generated by rules, each carrying the rule that produced it.",
);

insert(
  "alert",
  [
    "id",
    "tenant_id",
    "farm_id",
    "animal_id",
    "alert_type",
    "severity",
    "dedupe_key",
    "message",
    "evidence",
    "status",
    "acknowledged_by",
    "acknowledged_at",
    "resolved_at",
    "created_at",
  ],
  alerts,
  "Alerts with the evidence that raised them; the dedupe key keeps a recurring\n-- condition from becoming noise.",
);

insert(
  "recommendation",
  [
    "id",
    "tenant_id",
    "farm_id",
    "agent_name",
    "model_provider",
    "model_version",
    "prompt_version",
    "recommendation_text",
    "proposed_action_category",
    "proposed_action",
    "evidence_event_ids",
    "confidence",
    "assumptions",
    "risk_class",
    "status",
    "approved_by",
    "approved_at",
    "rejected_reason",
    "expires_at",
    "created_at",
    "event_id",
    "recommendation_key",
    "recommendation_params",
    "assumptions_key",
  ],
  recommendations,
  "Governed AI: every recommendation carries evidence event ids, a confidence,\n-- its assumptions, and a risk class. High-impact actions stay pending until a\n-- person approves them (invariant 6). Each also carries the message key and\n-- its facts so the console can render it in the reader's language.",
);

insert(
  "ai_action_audit",
  [
    "id",
    "tenant_id",
    "recommendation_id",
    "agent_name",
    "action",
    "outcome",
    "detail",
    "actor_type",
    "actor_id",
    "recorded_at",
  ],
  aiAudit,
  "The AI audit trail, including the autonomous execution the policy guard\n-- blocked outright.",
);

insert(
  "connector_registration",
  [
    "id",
    "tenant_id",
    "connector_type",
    "name",
    "config",
    "status",
    "created_at",
    "event_id",
  ],
  connectors,
  "Registered connectors, including one suspended and one in error.",
);

insert(
  "webhook_subscription",
  [
    "id",
    "tenant_id",
    "url",
    "event_families",
    "description",
    "secret",
    "secret_previous",
    "secret_rotated_at",
    "active",
    "created_at",
    "event_id",
  ],
  webhookSubscriptions,
  "Webhook subscriptions. The secrets are inert placeholders, not credentials:\n-- they sign nothing and exist only so the rotation state can be rendered.",
);

insert(
  "export_job",
  [
    "id",
    "tenant_id",
    "requested_by",
    "export_type",
    "format",
    "params",
    "status",
    "result_content",
    "result_ref",
    "result_checksum",
    "byte_size",
    "error",
    "expires_at",
    "created_at",
    "started_at",
    "completed_at",
    "event_id",
  ],
  exportJobs,
  "Export jobs across every status, including one that expired and was then\n-- denied on download.",
);

insert(
  "export_access_log",
  [
    "id",
    "tenant_id",
    "export_job_id",
    "action",
    "actor_type",
    "actor_id",
    "detail",
    "recorded_at",
  ],
  exportAccessLog,
  "Every touch of an export is logged — request, completion, download, denial.",
);

insert(
  "import_job",
  [
    "id",
    "tenant_id",
    "farm_id",
    "import_type",
    "status",
    "filename",
    "raw_content",
    "raw_checksum",
    "raw_format",
    "mapping",
    "total_rows",
    "valid_rows",
    "invalid_rows",
    "duplicate_rows",
    "executed_rows",
    "failed_rows",
    "created_by",
    "created_at",
    "event_id",
  ],
  importJobs,
  "Staged imports (§27): the raw file is preserved verbatim next to the mapping\n-- and the per-row outcome, so an import can always be explained after the fact.",
);

insert(
  "import_row",
  [
    "id",
    "tenant_id",
    "import_job_id",
    "row_number",
    "raw",
    "mapped",
    "validation_status",
    "errors",
    "execution_status",
    "server_id",
    "execution_error",
  ],
  importRows,
  "Row-level evidence, including the rows an operator still has to fix.",
);

insert(
  "domain_event",
  [
    "event_id",
    "tenant_id",
    "farm_id",
    "event_type",
    "schema_version",
    "aggregate_type",
    "aggregate_id",
    "aggregate_version",
    "occurred_at",
    "recorded_at",
    "actor_type",
    "actor_id",
    "source_channel",
    "correlation_id",
    "causation_id",
    "idempotency_key",
    "payload",
    "metadata",
  ],
  allEvents,
  `The append-only ledger: ${allEvents.length} events. Every state change above has\n-- its fact here, and the table forbids UPDATE and DELETE by trigger.`,
);

insert(
  "outbox_message",
  [
    "message_id",
    "tenant_id",
    "event_id",
    "subject",
    "envelope",
    "created_at",
    "published_at",
    "publish_attempts",
    "last_error",
  ],
  outbox,
  "Outbox rows a relay has already published — the second leg of the\n-- transactional outbox written in the same transaction as the event.",
);

insert(
  "webhook_delivery",
  [
    "id",
    "tenant_id",
    "subscription_id",
    "delivery_id",
    "event_id",
    "event_family",
    "event_type",
    "payload",
    "status",
    "attempts",
    "max_attempts",
    "next_attempt_at",
    "last_status_code",
    "last_error",
    "created_at",
    "delivered_at",
  ],
  deliveries,
  "Webhook deliveries, including one that exhausted its retries and went to the\n-- dead-letter state.",
);

insert(
  "webhook_delivery_attempt",
  [
    "id",
    "tenant_id",
    "delivery_id",
    "attempt_number",
    "outcome",
    "status_code",
    "error",
    "recorded_at",
  ],
  attempts,
  "Every attempt is recorded, so at-least-once delivery is auditable.",
);

emit(`
-- ---------------------------------------------------------------------------
-- Read-model projection statistics, so the observability screens have a
-- baseline to show.
-- ---------------------------------------------------------------------------`);

const aggregateTypes = [...new Set(allEvents.map((e) => e.aggregate_type))].sort();
insert(
  "projection_event_stats",
  ["tenant_id", "aggregate_type", "event_count", "last_event_at", "calculated_at"],
  aggregateTypes.map((type) => {
    const forType = allEvents.filter((e) => e.aggregate_type === type);
    return {
      tenant_id: TENANT,
      aggregate_type: type,
      event_count: forType.length,
      last_event_at: forType
        .map((e) => e.occurred_at)
        .sort()
        .slice(-1)[0],
      calculated_at: ts(0, 12),
    };
  }),
);

emit("");

writeFileSync(OUT, out.join("\n"));

const counts = {
  farms: FARMS.length,
  paddocks: paddocks.length,
  users: USERS.length,
  animals: animals.length,
  identifiers: identifiers.length,
  parentage: parentage.length,
  lots: lotRows.length,
  lotMemberships: lotMemberships.length,
  occupations: occupations.length,
  assessments: assessments.length,
  sessions: sessions.length,
  observations: observations.length,
  weights: weights.length,
  protocols: protocolRows.length,
  treatments: treatments.length,
  restrictions: restrictions.length,
  healthCases: healthCases.length,
  services: services.length,
  pregnancyChecks: pregnancyChecks.length,
  calvings: calvings.length,
  geneticEvaluations: geneticEvaluations.length,
  items: itemRows.length,
  batches: batches.length,
  stockMovements: stockMovements.length,
  assets: assetRows.length,
  workOrders: workOrders.length,
  entries: entries.length,
  allocations: allocations.length,
  sales: sales.length,
  budgets: budgetRows.length,
  tasks: tasks.length,
  alerts: alerts.length,
  recommendations: recommendations.length,
  connectors: connectors.length,
  webhooks: webhookSubscriptions.length,
  deliveries: deliveries.length,
  exports: exportJobs.length,
  importRows: importRows.length,
  events: allEvents.length,
  outbox: outbox.length,
};

console.log(`wrote ${OUT}`);
for (const [key, value] of Object.entries(counts)) {
  console.log(`  ${key.padEnd(22)} ${value}`);
}
