#!/usr/bin/env node
/**
 * OpenAPI backward-compatibility gate (JK-PLT-EES-001 §73 item 5, §74).
 *
 * Pragmatic structural comparer used by .github/workflows/contract-compatibility.yml
 * until a full semantic differ (e.g. oasdiff) is adopted — that tooling choice is
 * an open decision to be recorded as an ADR (see docs/adr/). This script blocks
 * the concrete breaking changes detectable structurally:
 *
 *   - a whole contract document present in base but missing in head;
 *   - a path + HTTP method (operation) present in base but missing in head;
 *   - a named component schema present in base but missing in head;
 *   - a required property entry (including nested objects and array items)
 *     present in base but missing in head — a removed/renamed field or a
 *     silently relaxed contract, both breaking for existing consumers.
 *
 * Additions in head are always allowed (expand before contract, §74).
 *
 * Usage:
 *   node scripts/validate/openapi-compat.mjs --base <dir> --head <dir>
 *   node scripts/validate/openapi-compat.mjs --help
 *
 * Exit codes: 0 compatible, 1 breaking changes found, 2 usage/parse error.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import YAML from "yaml";

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

const USAGE = `openapi-compat — structural OpenAPI backward-compatibility gate

Usage:
  node scripts/validate/openapi-compat.mjs --base <dir> --head <dir>

Options:
  --base <dir>   Directory of OpenAPI YAML documents from the base branch.
  --head <dir>   Directory of OpenAPI YAML documents from the head (PR) branch.
  --help         Show this help.

Fails (exit 1) when the base branch has documents, operations, schemas, or
required fields that are missing in head. Additions are always allowed.`;

function parseArgs(argv) {
  const args = { base: undefined, head: undefined, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--head") args.head = argv[++i];
    else {
      console.error(`unknown argument: ${arg}\n`);
      console.error(USAGE);
      process.exit(2);
    }
  }
  return args;
}

function listYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Recursively collect `required` property entries from a schema node,
 * keyed by a stable JSON-pointer-ish prefix so nested objects compare
 * position-for-position. Composition keywords (allOf/oneOf/anyOf) share
 * the parent prefix; the Set deduplicates.
 */
function collectRequired(node, prefix, entries) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node.required)) {
    for (const field of node.required) {
      if (typeof field === "string") entries.add(`${prefix} required:${field}`);
    }
  }
  if (node.properties && typeof node.properties === "object") {
    for (const [key, child] of Object.entries(node.properties)) {
      collectRequired(child, `${prefix}.${key}`, entries);
    }
  }
  if (node.items) collectRequired(node.items, `${prefix}[]`, entries);
  for (const keyword of ["allOf", "oneOf", "anyOf"]) {
    const variants = node[keyword];
    if (Array.isArray(variants)) {
      for (const variant of variants) collectRequired(variant, prefix, entries);
    }
  }
}

/** Collect the comparable surface of one OpenAPI document as a Set of strings. */
function collectEntries(file) {
  const doc = YAML.parse(readFileSync(file, "utf8"));
  const entries = new Set();
  if (doc === null || typeof doc !== "object") return entries;

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (item === null || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      if (method in item) entries.add(`operation ${method.toUpperCase()} ${path}`);
    }
  }
  for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
    entries.add(`schema ${name}`);
    collectRequired(schema, `schema ${name}`, entries);
  }
  return entries;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!args.base || !args.head) {
  console.error("both --base and --head are required\n");
  console.error(USAGE);
  process.exit(2);
}

const baseFiles = listYamlFiles(args.base);
const headFiles = new Map(listYamlFiles(args.head).map((f) => [basename(f), f]));
const breaking = [];
let documents = 0;
let compared = 0;

if (baseFiles.length === 0) {
  console.log(
    `openapi-compat: no OpenAPI documents under ${args.base} — nothing to gate`,
  );
  process.exit(0);
}

for (const baseFile of baseFiles) {
  const name = basename(baseFile);
  const headFile = headFiles.get(name);
  if (!headFile) {
    breaking.push(`${name}: contract document removed`);
    continue;
  }
  documents += 1;
  let baseEntries;
  let headEntries;
  try {
    baseEntries = collectEntries(baseFile);
    headEntries = collectEntries(headFile);
  } catch (error) {
    console.error(`openapi-compat: failed to parse ${name}: ${error.message}`);
    process.exit(2);
  }
  for (const entry of baseEntries) {
    compared += 1;
    if (!headEntries.has(entry)) breaking.push(`${name}: missing in head — ${entry}`);
  }
}

if (breaking.length > 0) {
  console.error("openapi-compat: BREAKING changes detected (base → head):\n");
  for (const problem of breaking) console.error(`  ✗ ${problem}`);
  console.error(
    "\nRemovals require a new API version or an expand-migrate-contract plan (§74).",
  );
  process.exit(1);
}
console.log(`openapi-compat OK (${documents} documents, ${compared} entries compared)`);
