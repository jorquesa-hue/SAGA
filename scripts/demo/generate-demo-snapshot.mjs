#!/usr/bin/env node
/**
 * Captures every GET the console makes against the seeded JQ Farm tenant into a
 * single JSON map (scripts/demo/snapshot.json), which the read-only demo shim
 * (scripts/demo/demo-api.js) serves so the console runs with no server behind it.
 *
 * One file rather than one-per-endpoint: the map is a build input the demo ships
 * verbatim, and a single artefact is far easier to review and diff than 1600
 * generated files.
 *
 * SYNTHETIC DATA ONLY. Every response here is a public read model of invented
 * records (database/seeds/README.md); no secret or credential is captured. This
 * runs in development against a migrated, seeded database with the API up:
 *
 *   pnpm db:migrate && pnpm db:seed
 *   node apps/api/dist/main.js         # APP_ENV=local, no OIDC_ISSUER_URL
 *   pnpm demo:snapshot
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "snapshot.json");

const API = process.env.DEMO_API_URL ?? "http://127.0.0.1:4000";
const TENANT = process.env.DEMO_TENANT_ID ?? "10000000-0000-4000-8000-000000000001";
const USER = process.env.DEMO_USER_ID ?? "12000000-0000-4000-8000-000000000001";
const headers = { "x-dev-user-id": USER, "x-tenant-id": TENANT };

/** The map the shim keys into: request path (no /api/v1/ prefix) → response. */
const snapshot = {};
const failures = [];

/** Fetch a path, store it under its shim key, and return the parsed body. */
async function grab(path, key = path.split("?")[0].replace(/\/+$/, "")) {
  let res;
  try {
    res = await fetch(`${API}/api/v1/${path}`, { headers });
  } catch (error) {
    failures.push(`${path} → ${(error && error.message) || "unreachable"}`);
    return null;
  }
  const text = await res.text();
  if (res.status !== 200) {
    failures.push(`${path} → ${res.status}`);
    return null;
  }
  const body = JSON.parse(text);
  snapshot[key] = body;
  return body;
}

/** Collections and reports every screen loads on mount. */
const ROOTS = [
  "dashboards/executive",
  "reports/farm-intelligence-index",
  "reports/monthly-nucleus",
  "tenants/current",
  "users",
  "farms",
  "alerts",
  "recommendations",
  "connectors",
  "exports",
  "imports",
  "webhooks/subscriptions",
  "webhooks/deliveries",
  "lots",
  "handling-sessions",
  "weights",
  "treatments",
  "restrictions",
  "health-protocols",
  "health-cases",
  "reproduction/events",
  "genetics/evaluations",
  "genetics/progress",
  "finance/entries",
  "finance/sales",
  "finance/budget-lines",
  "paddocks",
  "inventory/items",
  "inventory/expiring-batches",
  "assets",
  "work-orders",
  "tasks",
  "maintenance/due",
];

for (const path of ROOTS) await grab(path);

// The animal detail and traceability-record pages fetch exactly these on mount
// (apps/web/src/pages/AnimalDetail.tsx, TraceabilityRecord.tsx). Captured for
// the whole herd so no row in the list links to a hole.
const ANIMAL_VIEWS = [
  "",
  "/weights",
  "/treatments",
  "/restrictions",
  "/reproduction-status",
];
const animals = await grab("animals?limit=500", "animals");
const herd = animals?.items ?? [];
for (let i = 0; i < herd.length; i += 8) {
  await Promise.all(
    herd
      .slice(i, i + 8)
      .flatMap((a) => ANIMAL_VIEWS.map((sub) => grab(`animals/${a.id}${sub}`))),
  );
}

const lots = await grab("lots");
for (const lot of lots?.items ?? []) {
  for (const sub of ["/members", "/current-paddock", "/margin"])
    await grab(`lots/${lot.id}${sub}`);
}
for (const job of (await grab("exports"))?.items ?? []) await grab(`exports/${job.id}`);
for (const job of (await grab("imports"))?.items ?? []) {
  await grab(`imports/${job.id}`);
  await grab(`imports/${job.id}/preview`);
}
for (const rec of (await grab("recommendations"))?.items ?? [])
  await grab(`recommendations/${rec.id}`);
for (const c of (await grab("connectors"))?.items ?? []) await grab(`connectors/${c.id}`);
for (const sub of (await grab("webhooks/subscriptions"))?.items ?? [])
  await grab(`webhooks/subscriptions/${sub.id}`);

// The search box sends a query the static host cannot see, so one result set
// answers the bare "search" key.
await grab("search?q=JQ&limit=40", "search");

if (failures.length > 0) {
  console.error(`snapshot incomplete — ${failures.length} endpoint(s) failed:`);
  console.error(failures.slice(0, 30).join("\n"));
  process.exit(1);
}

// Stable key order so the committed file diffs cleanly between runs.
const ordered = {};
for (const key of Object.keys(snapshot).sort()) ordered[key] = snapshot[key];
writeFileSync(OUT, `${JSON.stringify(ordered, null, 0)}\n`);

const bytes = Buffer.byteLength(JSON.stringify(ordered));
console.log(
  `snapshot: ${Object.keys(ordered).length} endpoints, ${(bytes / 1024 / 1024).toFixed(2)} MB → ${OUT}`,
);
