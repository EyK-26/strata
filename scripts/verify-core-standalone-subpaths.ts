#!/usr/bin/env bun
/** Identity-bearing modules are pure standalone bundles, never legacy-root shims. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_SHARED_SUBPATH_SET, CORE_STANDALONE_SUBPATHS } from "./core-shared-subpaths";

const root = join(import.meta.dir, "..");
const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
const canonical = new Set<string>(CORE_STANDALONE_SUBPATHS);
const core = JSON.parse(await readFile(join(root, "packages/strata-core/package.json"), "utf8"));
const bootstrap = JSON.parse(
  await readFile(join(root, "packages/strata-bootstrap/package.json"), "utf8"),
);

// A package-root external flag matches every self subpath in Bun, splitting legacy
// owners between source aliases and this root bundle (notably SQL dialect state).
const rootBuildArguments = (core.scripts["build:bundle"] as string).split(/\s+/);
for (let index = 0; index < rootBuildArguments.length; index++) {
  if (rootBuildArguments[index] !== "--external") continue;
  const external = rootBuildArguments[index + 1]?.replace(/^['"]|['"]$/g, "");
  if (external === "@getstrata/core" || external?.startsWith("@getstrata/core/")) {
    assert(
      external !== "@getstrata/core" && canonical.has(external.slice("@getstrata/core/".length)),
      `Core root build externalizes a legacy owner: ${external}`,
    );
  }
}
const rootSource = await readFile(join(root, "packages/strata-core/dist/index.js"), "utf8");
for (const dependency of transpiler.scan(rootSource).imports) {
  const prefix = "@getstrata/core/";
  assert(dependency.path !== "@getstrata/core", "Core root bundle must not import its own root");
  if (!dependency.path.startsWith(prefix)) continue;
  assert(
    dependency.kind === "import-statement" && canonical.has(dependency.path.slice(prefix.length)),
    `Core root bundle imports noncanonical legacy owner: ${dependency.path}`,
  );
}

for (const subpath of canonical) {
  assert(!CORE_SHARED_SUBPATH_SET.has(subpath), `${subpath} must never shim the legacy root`);
  assert.equal(core.exports[`./${subpath}`].import, `./dist/entries/${subpath}.js`);
  for (const [name, manifest] of [
    ["core", core],
    ["bootstrap", bootstrap],
  ] as const) {
    for (const script of ["build:bundle", "build:subpaths"]) {
      assert(
        manifest.scripts[script].includes(`--external @getstrata/core/${subpath}`),
        `${name} ${script} must externalize ${subpath}`,
      );
    }
  }
  const source = await readFile(
    join(root, `packages/strata-core/dist/entries/${subpath}.js`),
    "utf8",
  );
  for (const dependency of transpiler.scan(source).imports) {
    const prefix = "@getstrata/core/";
    assert(
      dependency.kind === "import-statement",
      `${subpath} has unsupported dependency kind ${dependency.kind}`,
    );
    // This one canonical definition extends the one private ORM runtime class;
    // importing the public root shim would cycle through root queue exports.
    if (subpath === "queue/failedJobRepository" && dependency.path === "#strata-orm-runtime")
      continue;
    assert(
      dependency.path.startsWith(prefix),
      `${subpath} depends on a root shim or noncanonical module: ${dependency.path}`,
    );
    const target = dependency.path.slice(prefix.length);
    assert(
      canonical.has(target) ||
        (subpath === "config/applicationConfig" && target === "config/envSchema") ||
        (subpath === "queue/failedJobRepository" && target === "database/table"),
      `${subpath} imports unexpected ${target}`,
    );
  }
}
// Every public token must use the canonical opaque brand, including tokens defined in the root bundle.
const rootExports = await import(join(root, "packages/strata-core/dist/index.js"));
const canonicalTokens = await import("@getstrata/core/contracts/token");
const canonicalServices = await import("@getstrata/core/contracts/services");
for (const [name, value] of Object.entries(rootExports)) {
  if (!name.endsWith("_TOKEN")) continue;
  assert(
    canonicalTokens.isServiceToken(value),
    `Public ${name} has a private or invalid token brand`,
  );
  assert.doesNotThrow(
    () => canonicalServices.valueService(value as never, undefined),
    `Public ${name} must be accepted by canonical valueService`,
  );
}
// The policy adapter is consumed by installed bootstrap; source aliases must not hide missing exports.
const queuePolicy = await import(
  join(root, "packages/strata-core/dist/entries/queue/queueConfig.js")
);
for (const name of [
  "resolveQueueConfig",
  "snapshotQueueRetryPolicy",
  "resolveRedisQueueTransport",
  "readQueueVisibilityMs",
])
  assert.equal(typeof queuePolicy[name], "function", `Queue policy artifact is missing ${name}`);
assert.equal(
  "queueConfig" in queuePolicy,
  false,
  "Queue policy must not expose the removed ambient getter",
);
const capturedPolicy = queuePolicy.resolveQueueConfig({
  QUEUE_MAX_ATTEMPTS: "2",
  QUEUE_BACKOFF_MS: "0",
});
assert.equal(capturedPolicy.maxAttempts, 2);
assert(Object.isFrozen(capturedPolicy), "Queue policy must be immutable");
console.log(
  `Standalone canonical artifacts OK (${canonical.size}; packed identity is checked separately).`,
);
