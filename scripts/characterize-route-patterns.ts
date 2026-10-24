#!/usr/bin/env bun
/** Opt-in M1 feasibility only; no proposed startup validator or route API implementation. */
import assert from "node:assert/strict";
import { copyFile, mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";
import type { ProbeCase, Transport } from "./fixtures/m1-route-patterns/types.ts";

const root = resolve(import.meta.dir, "..");
const requestedOutput = process.argv[2];
assert.ok(
  requestedOutput && isAbsolute(requestedOutput),
  "Provide a new absolute evidence directory.",
);
const output: string = requestedOutput;
const alternate = process.argv.find((arg) => arg.startsWith("--cases="))?.slice(8);
const source = join(import.meta.dir, "fixtures/m1-route-patterns");
const casesPath = alternate ?? join(source, "cases.json");
assert.ok(isAbsolute(casesPath));
const cases: ProbeCase[] = JSON.parse(await readFile(casesPath, "utf8"));
assert.ok(cases.length > 0);
assert.equal(new Set(cases.map((item) => item.name)).size, cases.length);
for (const item of cases) {
  assert.ok(item.family === "transport" || item.family === "collector");
  assert.ok(
    item.classification === "contract-control" ||
      item.classification === "feasibility-observation" ||
      item.classification === "confirmed-defect-reproduction",
  );
  assert.ok(Array.isArray(item.declarations) && Array.isArray(item.requests));
}
await mkdir(output); // Never overwrite a historical receipt.
const scratch = join(output, "owned-scratch");
await mkdir(scratch);
await writeFile(
  join(output, "owned-scratch.json"),
  `${JSON.stringify({ path: scratch, createdByThisRun: true }, null, 2)}\n`,
  { flag: "wx" },
);
const priorTmp = process.env.TMPDIR;
process.env.TMPDIR = scratch;
const baselineTag = "v2.2.53";
function baseline(name: string) {
  const result = Bun.spawnSync(
    [
      "git",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "show",
      `${baselineTag}:tests/fixtures/${name}`,
    ],
    { cwd: root },
  );
  assert.equal(result.exitCode, 0, result.stderr.toString());
  return result.stdout;
}
const hash = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex");
const inputHashes = Object.fromEntries(
  await Promise.all(
    [
      ["runner", import.meta.path],
      ["consumer", join(source, "consumer.ts")],
      ["types", join(source, "types.ts")],
      ["cases", casesPath],
    ].map(async ([name, path]) => {
      assert.ok(name && path);
      return [name, await hash(path)];
    }),
  ),
);
inputHashes.originalNativeConsumer = new Bun.CryptoHasher("sha256")
  .update(baseline("nativeRouteConsumer.ts"))
  .digest("hex");
inputHashes.originalCollisionConsumer = new Bun.CryptoHasher("sha256")
  .update(baseline("routeCollisionConsumer.ts"))
  .digest("hex");
const results: Record<string, unknown>[] = [];
const baselineResults: Record<string, unknown>[] = [];
const packages: { name: string; version: string }[] = [];
async function save(status: "RUNNING" | "FAILED" | "COMPLETE", error?: unknown) {
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify({ status, runtime: Bun.version, revision: Bun.revision, publishedVersion: "2.2.53", baselineTag, packages, inputHashes, baselineResults, executed: results.length, contractControls: results.filter((r) => r.classification === "contract-control").length, observations: results.filter((r) => r.classification === "feasibility-observation").length, defectReproductions: results.filter((r) => r.classification === "confirmed-defect-reproduction").length, failed: results.filter((r) => r.exitCode !== 0).length, skipped: 0, results, error: error instanceof Error ? error.stack : error ? String(error) : undefined, limits: "Observations are not major API acceptance, a startup validator, browser/provider/asset qualification or a promise to preserve defects." }, null, 2)}\n`,
  );
}
let fixture: Awaited<ReturnType<typeof createGeneratedSecurityApp>> | undefined;
let active: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;
function interrupt() {
  interrupted = true;
  if (active?.exitCode === null) active.kill("SIGTERM");
}
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
let failure: unknown;
async function execute(args: string[], log: string, environment: Record<string, string>) {
  assert.equal(interrupted, false);
  assert.ok(fixture);
  const app = fixture.app;
  const file = await open(log, "wx");
  try {
    active = Bun.spawn([process.execPath, ...args], {
      cwd: app,
      env: environment,
      stdout: file.fd,
      stderr: file.fd,
      timeout: 30000,
      killSignal: "SIGTERM",
    });
    return await active.exited;
  } finally {
    active = undefined;
    await file.close();
  }
}
try {
  assert.ok(
    Bun.semver.satisfies(Bun.version, ">=1.4.4"),
    "Use Bun >=1.4.4; do not change the global Bun install.",
  );
  fixture = await createGeneratedSecurityApp(
    "sqlite",
    [
      "--frontend=api",
      "--tenancy=none",
      "--auth=headers",
      "--cache=array",
      "--queue=sync",
      "--mail=log",
      "--no-mfa",
      "--no-email-verification",
      "--no-scim",
      "--no-metrics",
      "--no-docker",
    ],
    { publishedVersion: "2.2.53", parentDirectory: scratch },
  );
  packages.length = 0;
  for (const part of ["core", "bootstrap", "cli"]) {
    const value = await Bun.file(
      join(fixture.app, `node_modules/@getstrata/${part}/package.json`),
    ).json();
    assert.equal(value.version, "2.2.53");
    packages.push({ name: value.name, version: value.version });
  }
  const target = join(fixture.app, "src/qualification");
  await mkdir(target);
  await copyFile(join(source, "consumer.ts"), join(target, "consumer.ts"));
  await copyFile(join(source, "types.ts"), join(target, "types.ts"));
  for (const [from, to] of [
    ["nativeRouteConsumer.ts", "original-native.ts"],
    ["routeCollisionConsumer.ts", "original-collision.ts"],
  ]) {
    assert.ok(from && to);
    await writeFile(join(target, to), baseline(from), { flag: "wx" });
  }
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
      ),
    ),
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
    DB_CONNECTION: "sqlite",
    TENANCY_DRIVER: "none",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    MAIL_DRIVER: "log",
    APP_ENV: "local",
    APP_URL: "http://127.0.0.1:3000",
    AUTH_DEV_HEADERS: "true",
    OTEL_SDK_DISABLED: "true",
  };
  for (const [name, args] of [
    ["typecheck", ["run", "check"]],
    ["migrate", [join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "migrate"]],
    ["original-native", [join(target, "original-native.ts")]],
    ["original-collision", [join(target, "original-collision.ts")]],
  ] as const) {
    const exitCode = await execute([...args], join(output, `${name}.log`), env);
    baselineResults.push({ name, exitCode });
    assert.equal(exitCode, 0, `Original ${name} failed; retain and investigate its log.`);
  }
  await mkdir(join(output, "cases"));
  for (const [index, item] of cases.entries()) {
    const modes: Transport[] =
      item.family === "collector" ? ["framework"] : ["native", "framework"];
    const casePath = join(output, "cases", `${index}.json`);
    await writeFile(casePath, `${JSON.stringify(item, null, 2)}\n`, { flag: "wx" });
    for (const mode of modes) {
      const receipt = join(output, "cases", `${index}-${mode}.json`);
      const log = join(output, "cases", `${index}-${mode}.log`);
      const exitCode = await execute(
        [join(target, "consumer.ts"), casePath, mode, receipt],
        log,
        env,
      );
      const observed = (await Bun.file(receipt).exists()) ? await Bun.file(receipt).json() : null;
      results.push({
        name: item.name,
        mode,
        classification: item.classification,
        exitCode,
        receipt: observed,
        log,
      });
      await save(exitCode === 0 ? "RUNNING" : "FAILED");
      assert.equal(
        exitCode,
        0,
        `${item.name}/${mode} failed; original logs and partial receipts retained.`,
      );
      assert.equal(observed?.status, "COMPLETE");
      console.log(`COMPLETE ${results.length}: ${item.name}/${mode} (${item.classification})`);
    }
  }
} catch (error) {
  failure = error;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  const errors: unknown[] = [];
  try {
    await fixture?.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    const entries = await readdir(scratch, { withFileTypes: true });
    for (const entry of entries) {
      assert.ok(
        entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          /^bunx-\d+-create-strata@2\.2\.53$/.test(entry.name),
        `Unexpected owned scratch entry: ${entry.name}`,
      );
      assert.equal(
        (
          await Bun.file(
            join(scratch, entry.name, "node_modules/create-strata/package.json"),
          ).json()
        ).version,
        "2.2.53",
      );
    }
    await rm(scratch, { recursive: true });
    await writeFile(
      join(output, "cleanup.json"),
      `${JSON.stringify(
        {
          ownedFixtureClosed: true,
          ownedScratchRemoved: true,
          unownedPathsRemoved: false,
          remainingEntriesRemoved: entries.map((e) => e.name),
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    errors.push(error);
  }
  if (priorTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = priorTmp;
  if (errors.length)
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...errors],
      "Probe and owned cleanup errors retained together.",
    );
}
await save(failure ? "FAILED" : "COMPLETE", failure);
if (failure) throw failure;
console.log(
  `M1 feasibility complete: ${results.length} isolated executions; observations remain separate from contract controls.`,
);
