#!/usr/bin/env node
/**
 * Builds a self-contained, read-only demonstration of the SAGA console.
 *
 * Why this exists: the console is a real client of a real API backed by
 * PostgreSQL + PostGIS, which makes "let me show you SAGA" a deployment
 * project. This script produces something that can be dropped on any static
 * host instead — the genuine Vite build of the console, served alongside a
 * captured snapshot of every GET the console makes against a seeded tenant.
 *
 * What it is NOT: a substitute for running the platform. Nothing here answers a
 * POST, so every command form (record a treatment, create a lot, approve a
 * recommendation) will fail against it. Reads are real data; writes need the
 * API and the database.
 *
 * Prerequisites: the API running against a migrated and seeded database.
 *
 *   pnpm db:migrate && pnpm db:seed
 *   node apps/api/dist/main.js          # APP_ENV=local, no OIDC_ISSUER_URL
 *   pnpm demo:static
 *
 * Output: apps/web/dist/ — deploy that directory as static files.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = join(ROOT, "apps/web");
const DIST = join(WEB, "dist");
const SNAPSHOT = join(DIST, "_api");

const API = process.env.DEMO_API_URL ?? "http://127.0.0.1:4000";
/** The JQ Farm demonstration tenant and its owner (database/seeds/README.md). */
const TENANT = process.env.DEMO_TENANT_ID ?? "10000000-0000-4000-8000-000000000001";
const USER = process.env.DEMO_USER_ID ?? "12000000-0000-4000-8000-000000000001";

const headers = { "x-dev-user-id": USER, "x-tenant-id": TENANT };

// ---------------------------------------------------------------------------
// 1. Build the console against a same-origin API path
// ---------------------------------------------------------------------------

console.log("building the console…");
execFileSync("npx", ["vite", "build"], {
  cwd: WEB,
  // An empty base makes the typed client request /api/v1/… on its own origin,
  // which is where the snapshot below is served from.
  env: { ...process.env, VITE_API_BASE_URL: "" },
  stdio: "inherit",
});

// ---------------------------------------------------------------------------
// 2. Capture every GET the console makes
// ---------------------------------------------------------------------------

let captured = 0;
const failures = [];

async function grab(path) {
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
  const file = join(SNAPSHOT, `${path}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  captured += 1;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

console.log("capturing the API snapshot…");
for (const path of ROOTS) await grab(path);

// Detail pages for the whole herd. Sampling would leave most rows in the
// animal list linking to a 404, which reads as a broken page rather than as a
// deliberately bounded demo — so every animal is captured.
const ANIMAL_VIEWS = [
  "",
  "/weights",
  "/treatments",
  "/restrictions",
  "/timeline",
  "/adg",
  "/reproduction-status",
  "/sale-clear",
];
const animals = await grab("animals?limit=500");
// The client requests /animals with its own query string, which the static host
// drops, so the unfiltered set has to answer the bare path too.
if (animals) {
  writeFileSync(join(SNAPSHOT, "animals.json"), JSON.stringify(animals));
}
const herd = animals?.items ?? [];
for (let i = 0; i < herd.length; i += 8) {
  await Promise.all(
    herd
      .slice(i, i + 8)
      .flatMap((animal) => ANIMAL_VIEWS.map((sub) => grab(`animals/${animal.id}${sub}`))),
  );
}
console.log(`  ${herd.length} animals`);

const lots = await grab("lots");
for (const lot of lots?.items ?? []) {
  for (const sub of ["/members", "/current-paddock", "/margin"]) {
    await grab(`lots/${lot.id}${sub}`);
  }
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

// Static hosting drops the query string, so one unfiltered result set backs the
// search box rather than a per-term snapshot that could never all be captured.
const search = await fetch(`${API}/api/v1/search?q=JQ&limit=40`, { headers });
if (search.status === 200) {
  writeFileSync(join(SNAPSHOT, "search.json"), await search.text());
  captured += 1;
}

// ---------------------------------------------------------------------------
// 3. Routing for a static host
// ---------------------------------------------------------------------------

// Vercel resolves the filesystem before rewrites, so real assets keep winning
// and only unmatched paths fall through: /api/v1/x → /_api/x.json, and anything
// else → index.html for the SPA router.
writeFileSync(
  join(DIST, "vercel.json"),
  `${JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      rewrites: [
        { source: "/api/v1/:path*", destination: "/_api/:path*.json" },
        { source: "/(.*)", destination: "/index.html" },
      ],
    },
    null,
    2,
  )}\n`,
);

// The same two rules for Netlify / Cloudflare Pages, which read _redirects.
writeFileSync(
  join(DIST, "_redirects"),
  ["/api/v1/*  /_api/:splat.json  200", "/*  /index.html  200", ""].join("\n"),
);

writeFileSync(
  join(DIST, "README.txt"),
  [
    "SAGA — read-only demonstration build",
    "",
    "The genuine console, served with a captured snapshot of the JQ Farm",
    "demonstration tenant. All data is synthetic (database/seeds/README.md).",
    "",
    `Sign in with  user ${USER}`,
    `              org  ${TENANT}`,
    "",
    "Reads are real. Writes are not: every command form will fail, because",
    "nothing here answers a POST. For the full platform run the API and the",
    "database — see the repository README.",
    "",
  ].join("\n"),
);

const bytes = execFileSync("du", ["-sh", DIST]).toString().split("\t")[0];
console.log(`\nsnapshot: ${captured} endpoints captured, ${failures.length} failed`);
if (failures.length > 0) console.log(failures.slice(0, 20).join("\n"));
console.log(`output:   ${DIST} (${bytes.trim()})`);
console.log(`sign in:  user ${USER} / org ${TENANT}`);
