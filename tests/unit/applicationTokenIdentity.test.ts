import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isServiceToken } from "@getstrata/core/contracts/token";
import { CORE_VIEW_RENDERER_TOKEN as sourceViewToken } from "@getstrata/core/view";
import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view/tokens";

async function mixedConsumer(mode: "view" | "dialect" | "execution") {
  const repository = join(import.meta.dir, "../..");
  const fixture = join(import.meta.dir, "../fixtures/applicationTokenIdentityMixedConsumer.ts");
  const child = Bun.spawn(
    [process.execPath, "--tsconfig-override", join(repository, "tsconfig.json"), fixture, mode],
    {
      cwd: repository,
      env: { ...process.env, ...(mode === "dialect" ? { DB_CONNECTION: "pgsql" } : {}) },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10000,
    },
  );
  const [output, errors, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exit, 0, `Mixed source/built ${mode} regression: ${output}\n${errors}`);
  return JSON.parse(output.trim());
}

test("mixed workspace source/built view provider resolves through both public token owners", async () => {
  assert.equal(isServiceToken(CORE_VIEW_RENDERER_TOKEN), true);
  assert.equal(CORE_VIEW_RENDERER_TOKEN, sourceViewToken);
  assert.equal((await mixedConsumer("view")).providerResolved, true);
});

test("built root MySQL dialect drives its query compiler despite source aliases and ambient PostgreSQL", async () => {
  assert.equal((await mixedConsumer("dialect")).dialect, "mysql");
});

test("mixed workspace execution uses one canonical context across built root runtime and source", async () => {
  const report = await mixedConsumer("execution");
  assert.equal(report.contextIdentity, true);
  assert.equal(report.eagerFactories, 2);
  assert.equal(report.isolatedContexts, true);
});
