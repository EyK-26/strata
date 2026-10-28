/** Opt-in characterization: legacy context creation does not acquire the M1 reservation. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { collectProviders, createAppContext } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "@getstrata/bootstrap/m1";
import { resolveApplicationDependencies } from "@getstrata/core/runtime/applicationRegistry";

const base = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
const rows: { case: string; passed: true }[] = [];
const legacy = await createAppContext(base());
try {
  await assert.rejects(
    startGuardedApplication({ providers: base(), modules: [] }),
    /already active/,
  );
  assert.equal(resolveApplicationDependencies(), legacy.dependencies);
  rows.push({ case: "legacy-first-prevents-M1-acquisition", passed: true });
} finally {
  await legacy.dispose();
}
let modernCloses = 0;
let legacyCloses = 0;
const modern = await startGuardedApplication({
  providers: [
    ...base(),
    {
      name: "owned.modern",
      register({ onCleanup }) {
        onCleanup(() => {
          modernCloses++;
        });
      },
    },
  ],
  modules: [],
});
let late: Awaited<ReturnType<typeof createAppContext>> | undefined;
try {
  // Intentionally exercise the unsupported direction; no broad legacy API change is made here.
  late = await createAppContext([
    ...base(),
    {
      name: "owned.legacy",
      register({ onCleanup }) {
        onCleanup(() => {
          legacyCloses++;
        });
      },
    },
  ]);
  assert.equal(resolveApplicationDependencies(), late.dependencies);
  assert.equal((await modern.shutdown()).successful, true);
  assert.equal(modernCloses, 1);
  assert.equal(legacyCloses, 0);
  assert.equal(resolveApplicationDependencies(), late.dependencies);
  await assert.rejects(
    startGuardedApplication({ providers: base(), modules: [] }),
    /already active/,
  );
  rows.push({
    case: "late-legacy-context-is-outside-M1-ownership-and-remains-caller-owned",
    passed: true,
  });
} finally {
  await late?.dispose();
  await modern.server.stop(true);
}
assert.equal(legacyCloses, 1);
const retried = await startGuardedApplication({ providers: base(), modules: [] });
assert.equal((await retried.shutdown()).successful, true);
rows.push({ case: "deliberate-cleanup-permits-single-entrypoint-restart", passed: true });
const target = process.argv[2];
assert.ok(target);
await writeFile(
  target,
  JSON.stringify(
    {
      executed: rows.length,
      failed: 0,
      skipped: 0,
      rows,
      scope:
        "Characterization of current legacy/M1 boundary, not support for mixed entrypoints or multiple contexts. Adopt exactly one runtime owner per process.",
    },
    null,
    2,
  ),
  { flag: "wx" },
);
