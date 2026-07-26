#!/usr/bin/env node
/**
 * Turns a plain Vite build of the console into the read-only demo bundle:
 * copies the captured snapshot and the fetch shim into apps/web/dist/_demo/ and
 * injects the shim ahead of the app bundle in index.html.
 *
 * No database and no API: it consumes the committed snapshot, so it runs in a
 * CI/host build (this is the second half of the `vercel.json` build command).
 * Run `pnpm demo:snapshot` first, against a seeded database, to refresh the
 * snapshot; that step needs the API, this one never does.
 */
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const DIST = join(ROOT, "apps/web/dist");
const DEMO = join(DIST, "_demo");

const index = join(DIST, "index.html");
if (!existsSync(index)) {
  console.error(`no build at ${DIST} — run the web build first`);
  process.exit(1);
}
const snapshot = join(HERE, "snapshot.json");
if (!existsSync(snapshot)) {
  console.error(`no snapshot at ${snapshot} — run pnpm demo:snapshot first`);
  process.exit(1);
}

mkdirSync(DEMO, { recursive: true });
copyFileSync(snapshot, join(DEMO, "snapshot.json"));
copyFileSync(join(HERE, "demo-api.js"), join(DEMO, "demo-api.js"));

// Inject the shim as the first script in <head> so it patches fetch before the
// app's module bundle runs. Idempotent: a second run does not double-inject.
let html = readFileSync(index, "utf8");
const tag = '<script src="/_demo/demo-api.js"></script>';
if (!html.includes(tag)) {
  html = html.replace("<head>", `<head>\n    ${tag}`);
  writeFileSync(index, html);
}

const TENANT = "10000000-0000-4000-8000-000000000001";
const USER = "12000000-0000-4000-8000-000000000001";
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
    "Reads are real. Writes are not: every command form returns a read-only",
    "notice, because nothing here answers a POST. For the full platform run the",
    "API and the database — see the repository README.",
    "",
  ].join("\n"),
);

const bytes = readFileSync(snapshot).length;
console.log(`demo bundle ready at ${DIST}`);
console.log(
  `  snapshot ${(bytes / 1024 / 1024).toFixed(2)} MB, shim injected into index.html`,
);
console.log(`  sign in: user ${USER} / org ${TENANT}`);
