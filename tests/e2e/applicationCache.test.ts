import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatePackage } from "../../scripts/candidate-packages";

async function run(args: string[], cwd: string, timeout = 30000) {
  const child = Bun.spawn(args, { cwd, env: process.env, stdout: "pipe", stderr: "pipe", timeout });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exit, 0, `${args[0]} failed (${exit})\n${stdout}\n${stderr}`);
  return stdout;
}

test("installed canonical cache bindings own loaders, honor overrides and retain explicit response policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-cache-consumer-"));
  const root = join(import.meta.dir, "../..");
  const dependencies: Record<string, string> = {};
  const archives: Record<string, string> = {};
  try {
    for (const part of ["core", "bootstrap"] as const) {
      const archive = await candidatePackage(part, directory);
      dependencies[`@getstrata/${part}`] = `file:${archive}`;
      archives[part] = createHash("sha256")
        .update(await readFile(archive))
        .digest("hex");
    }
    // Root imports retain existing optional peers; pin the same installed versions,
    // with an independent consumer dependency tree and no framework source aliases.
    for (const name of ["eta", "mysql2", "@node-saml/node-saml", "typescript", "@types/bun"]) {
      const manifest = JSON.parse(
        await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
      );
      dependencies[name] = manifest.version;
    }
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module", dependencies }),
    );
    await run([process.execPath, "install", "--ignore-scripts"], directory, 120000);
    for (const part of ["core", "bootstrap"]) {
      const installed = join(directory, "node_modules/@getstrata", part);
      assert.equal(
        await realpath(installed),
        installed,
        "Framework package must not be a workspace symlink",
      );
    }
    await copyFile(
      join(root, "tests/fixtures/applicationCacheConsumer.ts"),
      join(directory, "consumer.ts"),
    );
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "Preserve",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["bun"],
          allowImportingTsExtensions: true,
        },
        include: ["consumer.ts"],
      }),
    );
    await run(
      [join(directory, "node_modules/.bin/tsc"), "--noEmit", "-p", "tsconfig.json"],
      directory,
    );
    const report = JSON.parse((await run([process.execPath, "consumer.ts"], directory)).trim());
    assert.equal(report.operationIdentity, true);
    assert.equal(report.canonicalBindings, true);
    assert.equal(report.actualLoaderJoined, true);
    assert.equal(report.handoff.sourceResult, "request-result");
    assert.deepEqual(report.handoff.jobOutcome, { ok: true, value: "job-result" });
    assert.equal(report.handoff.freshExecution, true);
    assert.deepEqual(report.handoff.actor, { kind: "system", policy: "packed-handoff" });
    assert.deepEqual(report.handoff.tenant, { id: "job-tenant" });
    assert.equal(report.handoff.targetValueBefore, 41);
    assert.equal(report.handoff.targetValueAfter, 41);
    assert.equal(report.handoff.capturedHandleUse, "alive:job");
    assert.deepEqual(report.handoff.lifecycle, [
      "request.open",
      "job.open",
      "request.body.end",
      "request.close",
      "job.body.end",
      "job.close",
    ]);
    assert.equal(report.fakeCalls, 3);
    assert.equal(report.loads, 1);
    assert.deepEqual(report.responseStatuses, [200, 304, 200]);
    const lockHash = createHash("sha256")
      .update(await readFile(join(directory, "bun.lock")))
      .digest("hex");
    console.log(
      JSON.stringify({
        archives,
        consumerLockSha256: lockHash,
        compiler: dependencies.typescript,
        report,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);
