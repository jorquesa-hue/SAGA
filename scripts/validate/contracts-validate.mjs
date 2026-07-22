#!/usr/bin/env node
/**
 * Contract validation pipeline (JK-PLT-EES-001 §45-§52, Volume XIII #3-#5):
 *  - OpenAPI documents parse and validate (swagger-parser, full deref).
 *  - GraphQL SDL builds into a valid schema (graphql-js).
 *  - AsyncAPI documents parse as YAML with required structural fields, and
 *    every referenced JSON Schema file parses as JSON.
 *
 * CI runs this on every pull request; drift between generated artifacts and
 * committed contracts fails the build.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { buildSchema } from "graphql";
import YAML from "yaml";

const root = new URL("../..", import.meta.url).pathname;
const contractsDir = join(root, "contracts");
const problems = [];
let validated = 0;

function listFiles(dir, extensions) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => extensions.some((ext) => f.endsWith(ext)))
    .map((f) => join(dir, f));
}

// --- OpenAPI ---------------------------------------------------------------
for (const file of listFiles(join(contractsDir, "openapi"), [".yaml", ".yml"])) {
  try {
    const api = await SwaggerParser.validate(file);
    if (!api.openapi?.startsWith("3.")) {
      problems.push(`${file}: expected OpenAPI 3.x, got ${api.openapi}`);
    }
    validated += 1;
  } catch (error) {
    problems.push(`${file}: ${error.message}`);
  }
}

// --- GraphQL ---------------------------------------------------------------
for (const file of listFiles(join(contractsDir, "graphql"), [".graphql", ".gql"])) {
  try {
    buildSchema(readFileSync(file, "utf8"));
    validated += 1;
  } catch (error) {
    problems.push(`${file}: ${error.message}`);
  }
}

// --- AsyncAPI (structural) -------------------------------------------------
for (const file of listFiles(join(contractsDir, "asyncapi"), [".yaml", ".yml"])) {
  try {
    const doc = YAML.parse(readFileSync(file, "utf8"));
    if (!doc.asyncapi?.startsWith("3.")) {
      problems.push(`${file}: expected AsyncAPI 3.x, got ${doc.asyncapi}`);
    }
    for (const key of ["info", "channels"]) {
      if (!doc[key]) problems.push(`${file}: missing required '${key}'`);
    }
    validated += 1;
  } catch (error) {
    problems.push(`${file}: ${error.message}`);
  }
}

// --- JSON Schemas ----------------------------------------------------------
for (const file of listFiles(join(contractsDir, "json-schema"), [".json"])) {
  try {
    const schema = JSON.parse(readFileSync(file, "utf8"));
    if (!schema.$id && !schema.$schema) {
      problems.push(`${file}: JSON Schema should declare $schema or $id`);
    }
    validated += 1;
  } catch (error) {
    problems.push(`${file}: ${error.message}`);
  }
}

if (validated === 0) {
  problems.push("no contract documents found under contracts/ — pipeline misconfigured");
}

if (problems.length > 0) {
  console.error("Contract validation problems:\n");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`contracts:validate OK (${validated} documents)`);
