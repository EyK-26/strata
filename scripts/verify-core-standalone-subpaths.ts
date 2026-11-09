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
    assert(
      dependency.path.startsWith(prefix),
      `${subpath} depends on a root shim or noncanonical module: ${dependency.path}`,
    );
    const target = dependency.path.slice(prefix.length);
    assert(
      canonical.has(target) ||
        (subpath === "config/applicationConfig" && target === "config/envSchema"),
      `${subpath} imports unexpected ${target}`,
    );
  }
}
console.log(
  `Standalone canonical artifacts OK (${canonical.size}; packed identity is checked separately).`,
);
