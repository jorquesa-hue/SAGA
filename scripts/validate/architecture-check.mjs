#!/usr/bin/env node
/**
 * Architecture boundary enforcement (JK-PLT-EES-001 §35, §36, Appendix F):
 *
 *  1. domain-kernel depends on no workspace package.
 *  2. Feature (bounded-context) packages may depend on @jk/domain-kernel and
 *     approved shared technical packages only — never on another feature
 *     package. Cross-context collaboration uses application ports or events.
 *  3. No source file deep-imports another workspace package's internals
 *     (e.g. "@jk/x/dist/...", "@jk/x/src/..." or a relative path that escapes
 *     the package into a sibling package).
 *
 * Exit code 1 with a violation report when any rule is broken.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../..", import.meta.url).pathname;

const FEATURE_PACKAGES = new Set([
  "@jk/identity-tenancy",
  "@jk/animal-registry",
  "@jk/herd-operations",
  "@jk/reproduction-genetics",
  "@jk/health-laboratory",
  "@jk/land-grazing",
  "@jk/nutrition-inventory",
  "@jk/finance-commerce",
  "@jk/assets-maintenance",
  "@jk/automation-integration",
  "@jk/analytics-intelligence",
  "@jk/data-import",
]);

const SHARED_TECHNICAL = new Set([
  "@jk/domain-kernel",
  "@jk/database",
  "@jk/observability",
  "@jk/security",
  "@jk/localization",
  "@jk/testkit",
  "@jk/contracts-rest",
  "@jk/contracts-graphql",
  "@jk/contracts-events",
  "@jk/offline-sync",
  "@jk/sync-http",
]);

const violations = [];

function workspacePackages() {
  const results = [];
  for (const group of ["packages", "apps"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const pkgFile = join(dir, entry, "package.json");
      if (existsSync(pkgFile)) {
        const manifest = JSON.parse(readFileSync(pkgFile, "utf8"));
        results.push({ dir: join(dir, entry), name: manifest.name, manifest, group });
      }
    }
  }
  return results;
}

const packages = workspacePackages();

// Rule 1 + 2: manifest-level dependency rules.
for (const pkg of packages) {
  const deps = Object.keys({
    ...pkg.manifest.dependencies,
    ...pkg.manifest.devDependencies,
  }).filter((d) => d.startsWith("@jk/"));

  if (pkg.name === "@jk/domain-kernel" && deps.length > 0) {
    violations.push(`${pkg.name}: domain-kernel must not depend on workspace packages (found ${deps.join(", ")})`);
  }

  if (FEATURE_PACKAGES.has(pkg.name)) {
    for (const dep of deps) {
      if (FEATURE_PACKAGES.has(dep)) {
        violations.push(
          `${pkg.name}: feature package depends on feature package ${dep} — use application ports or events`,
        );
      } else if (!SHARED_TECHNICAL.has(dep)) {
        violations.push(`${pkg.name}: dependency ${dep} is not an approved shared package`);
      }
    }
  }
}

// Rule 3: source-level deep import scan.
const DEEP_IMPORT_RE = /from\s+["'](@jk\/[a-z-]+)\/(dist|src)\//;
const SIBLING_ESCAPE_RE = /from\s+["'](\.\.\/){2,}(packages|apps)\//;

function scanSources(dir) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", "coverage", ".turbo"].includes(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      scanSources(full);
    } else if (/\.(ts|mts|tsx)$/.test(entry)) {
      const content = readFileSync(full, "utf8");
      const rel = relative(root, full);
      const deep = DEEP_IMPORT_RE.exec(content);
      if (deep) {
        violations.push(`${rel}: deep import into ${deep[1]}/${deep[2]} — import the package public API`);
      }
      const escape = SIBLING_ESCAPE_RE.exec(content);
      if (escape) {
        violations.push(`${rel}: relative import escapes the package into a sibling`);
      }
    }
  }
}

for (const pkg of packages) {
  scanSources(pkg.dir);
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:\n");
  for (const violation of violations) console.error(`  ✗ ${violation}`);
  process.exit(1);
}
console.log(`architecture:check OK (${packages.length} workspace packages verified)`);
