#!/usr/bin/env bun
/** Opt-in published-consumer characterization, not the proposed M1 validator. */
import assert from "node:assert/strict";
import { mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";
import { installStartupProbe, STARTUP_PROBE_OPTIONS } from "../tests/helpers/startupProbe.ts";
import { type ProbeCase, STARTUP_PROBE_MODES } from "./fixtures/m1-startup/types.ts";

const repo = resolve(import.meta.dir, "..");
const requestedOutput = process.argv[2];
assert.ok(requestedOutput && isAbsolute(requestedOutput));
const output: string = requestedOutput;
const source = join(import.meta.dir, "fixtures/m1-startup");
const casesPath =
  process.argv.find((v) => v.startsWith("--cases="))?.slice(8) ?? join(source, "cases.json");
const cases: ProbeCase[] = JSON.parse(await readFile(casesPath, "utf8"));
assert.ok(cases.length);
for (const item of cases) {
  assert.ok(STARTUP_PROBE_MODES.includes(item.mode));
  assert.ok(
    ["contract-control", "feasibility-observation", "confirmed-defect-reproduction"].includes(
      item.classification,
    ),
  );
  assert.ok(Number.isSafeInteger(item.expectedFactoryCalls) && item.expectedFactoryCalls >= 0);
}

assert.equal(new Set(cases.map((v) => v.mode)).size, cases.length);
assert.ok(
  Bun.semver.satisfies(Bun.version, ">=1.4.4"),
  "Use Bun >=1.4.4 without changing global Bun.",
);
const baselineTag = "v2.2.54";
function blob(name: string) {
  const result = Bun.spawnSync(
    [
      "git",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "show",
      `${baselineTag}:tests/fixtures/${name}`,
    ],
    { cwd: repo },
  );
  assert.equal(result.exitCode, 0, result.stderr.toString());
  return result.stdout;
}
const originals = {
  native: blob("nativeRouteConsumer.ts"),
  collision: blob("routeCollisionConsumer.ts"),
};
const hash = (value: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
const inputs = Object.fromEntries(
  await Promise.all(
    [
      ["runner", import.meta.path],
      ["installer", join(repo, "tests/helpers/startupProbe.ts")],
      ["consumer", join(source, "consumer.ts")],
      ["module", join(source, "module.ts")],
      ["state", join(source, "state.ts")],
      ["types", join(source, "types.ts")],
      ["cases", casesPath],
    ].map(async ([name, path]) => {
      assert.ok(name && path);
      return [name, hash(await readFile(path))];
    }),
  ),
);
await mkdir(output);
const scratch = join(output, "owned-scratch");
await mkdir(scratch);
await writeFile(
  join(output, "ownership.json"),
  `${JSON.stringify({ scratch, createdByThisRun: true }, null, 2)}\n`,
  { flag: "wx" },
);
const oldTmp = process.env.TMPDIR;
process.env.TMPDIR = scratch;
let fixture: Awaited<ReturnType<typeof createGeneratedSecurityApp>> | undefined;
let active: ReturnType<typeof Bun.spawn> | undefined;
const results: Record<string, unknown>[] = [];
const baselines: Record<string, unknown>[] = [];
let failure: unknown;
async function save(status: string) {
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(
      {
        status,
        runtime: Bun.version,
        revision: Bun.revision,
        publishedVersion: "2.2.54",
        baselineTag,
        inputs,
        originalSha256: { native: hash(originals.native), collision: hash(originals.collision) },
        baselines,
        executed: results.length,
        failed: results.filter((v) => v.exitCode !== 0).length,
        skipped: 0,
        results,
        error: failure instanceof Error ? failure.stack : undefined,
      },
      null,
      2,
    )}\n`,
  );
}
async function run(args: string[], name: string, env: Record<string, string>) {
  assert.ok(fixture);
  const file = await open(join(output, `${name}.log`), "wx");
  try {
    active = Bun.spawn([process.execPath, ...args], {
      cwd: fixture.app,
      env,
      stdout: file.fd,
      stderr: file.fd,
      timeout: 45000,
      killSignal: "SIGTERM",
    });
    return await active.exited;
  } finally {
    active = undefined;
    await file.close();
  }
}
function interrupt() {
  if (active?.exitCode === null) active.kill("SIGTERM");
}
process.once("SIGTERM", interrupt);
process.once("SIGINT", interrupt);
try {
  fixture = await createGeneratedSecurityApp("sqlite", STARTUP_PROBE_OPTIONS, {
    publishedVersion: "2.2.54",
    parentDirectory: scratch,
  });
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) =>
        ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(k),
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
  for (const part of ["core", "bootstrap", "cli"])
    assert.equal(
      (await Bun.file(join(fixture.app, `node_modules/@getstrata/${part}/package.json`)).json())
        .version,
      "2.2.54",
    );
  const target = join(fixture.app, "src/qualification");
  await mkdir(target);
  for (const [name, body] of Object.entries(originals))
    await writeFile(join(target, `original-${name}.ts`), body, { flag: "wx" });
  for (const [name, args] of [
    ["original-types", ["run", "check"]],
    ["migrate", [join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "migrate"]],
    ["original-native", [join(target, "original-native.ts")]],
    ["original-collision", [join(target, "original-collision.ts")]],
  ] as const) {
    const exitCode = await run([...args], name, env);
    baselines.push({ name, exitCode });
    assert.equal(exitCode, 0, `Original ${name} failed; inspect retained log.`);
  }
  await installStartupProbe(fixture.app);
  const typed = await run(["run", "check"], "probe-types", env);
  baselines.push({ name: "probe-types", exitCode: typed });
  assert.equal(typed, 0, "Probe must satisfy the current public API types.");
  await mkdir(join(output, "cases"));
  for (const [index, item] of cases.entries()) {
    const data = join(output, "cases", `${index}.input.json`);
    const receipt = join(output, "cases", `${index}.json`);
    await writeFile(data, `${JSON.stringify(item, null, 2)}\n`, { flag: "wx" });
    const exitCode = await run([join(target, "consumer.ts"), data, receipt], `case-${index}`, env);
    const observed = (await Bun.file(receipt).exists()) ? await Bun.file(receipt).json() : null;
    results.push({
      name: item.mode,
      classification: item.classification,
      exitCode,
      receipt: observed,
    });
    await save(exitCode === 0 ? "RUNNING" : "FAILED");
    assert.equal(exitCode, 0, `${item.mode} failed; retain partial evidence.`);
    assert.equal(observed?.status, "COMPLETE");
    console.log(`COMPLETE ${results.length}/${cases.length} ${item.mode}`);
  }
} catch (error) {
  failure = error;
} finally {
  process.off("SIGTERM", interrupt);
  process.off("SIGINT", interrupt);
  const errors: unknown[] = [];
  try {
    await fixture?.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    const entries = await readdir(scratch, { withFileTypes: true });
    for (const e of entries) {
      assert.ok(
        e.isDirectory() && !e.isSymbolicLink() && /^bunx-\d+-create-strata@2\.2\.54$/.test(e.name),
      );
      assert.equal(
        (await Bun.file(join(scratch, e.name, "node_modules/create-strata/package.json")).json())
          .version,
        "2.2.54",
      );
    }
    await rm(scratch, { recursive: true });
    await writeFile(
      join(output, "cleanup.json"),
      `${JSON.stringify(
        {
          ownedFixtureClosed: true,
          ownedScratchRemoved: true,
          unknownResourcesRemoved: false,
          entriesRemoved: entries.map((v) => v.name),
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    errors.push(error);
  }
  if (oldTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = oldTmp;
  if (errors.length)
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...errors],
      "Probe and owned cleanup failures retained",
    );
}
await save(failure ? "FAILED" : "COMPLETE");
if (failure) throw failure;
