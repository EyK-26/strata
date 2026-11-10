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

test("installed explicit database sessions preserve package identity, native SQLite semantics and strict public types", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-database-consumer-"));
  const root = join(import.meta.dir, "../..");
  const dependencies: Record<string, string> = {};
  const archives: Record<string, string> = {};
  try {
    for (const part of ["core"] as const) {
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
    for (const part of ["core"]) {
      const installed = join(directory, "node_modules/@getstrata", part);
      assert.equal(
        await realpath(installed),
        installed,
        "Framework package must not be a workspace symlink",
      );
    }
    await copyFile(
      join(root, "tests/fixtures/databaseSessionConsumer.ts"),
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
    assert.equal(report.canonicalToken, true);
    assert.equal(report.canonicalPersistenceError, true);
    assert.equal(report.neutralConstraintHttpMapping, true);
    assert.equal(report.internalTokensHidden, true);
    assert.equal(report.namedIsolation, true);
    assert.equal(report.transaction, true);
    assert.equal(report.staleAuthorityRejected, true);
    assert.equal(report.paths.length, 8);
    assert.deepEqual(
      report.postgresMetrics,
      (process.env.M3A_PG_RUNTIME_URL ??
        process.env.RLS_TEST_DATABASE_URL ??
        process.env.APP_DATABASE_URL)
        ? { status: "passed", acquired: 1 }
        : { status: "omitted-no-runtime-url" },
    );
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
