#!/usr/bin/env bun
/** Opt-in published-consumer characterization, not the proposed M1 validator. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../packages/strata-starter/src/parseArgs.ts";
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
const sourceRuntime = process.argv.includes("--source");
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
let fixture:
  | { app: string; runtimeUrl: string; migrationUrl: string; close(): Promise<void> }
  | undefined;
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
        runtimeSource: sourceRuntime ? "source" : "installed-candidate",
        inputs,
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
  if (sourceRuntime) {
    const root = await mkdtemp(join(scratch, "source-startup-"));
    const app = join(root, "app");
    generateProject({
      projectName: "source-startup",
      targetDir: app,
      layers: layersFromFlags(
        parseCreateStrataArgs([
          "source-startup",
          "--database=sqlite",
          ...STARTUP_PROBE_OPTIONS,
          "--yes",
        ]),
      ),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });
    // Explicit source-only resolution. No archive installation or package build.
    await symlink(join(repo, "node_modules"), join(app, "node_modules"), "dir");
    const config = await Bun.file(join(app, "tsconfig.json")).json();
    const sourceConfig = await Bun.file(join(repo, "tsconfig.json")).json();
    const paths: Record<string, string[]> = {};
    for (const [name, values] of Object.entries(sourceConfig.compilerOptions.paths))
      paths[name] = (values as string[]).map((value) => resolve(repo, value));
    paths["@getstrata/core/database/migrations"] = [
      join(repo, "src/core/database/migrations/runner.ts"),
    ];
    config.compilerOptions.lib = sourceConfig.compilerOptions.lib;
    config.compilerOptions.paths = { ...config.compilerOptions.paths, ...paths };
    await writeFile(join(app, "tsconfig.json"), JSON.stringify(config, null, 2));
    const url = `sqlite://${join(root, "startup.sqlite")}`;
    fixture = {
      app,
      runtimeUrl: url,
      migrationUrl: url,
      close: () => rm(root, { recursive: true, force: true }),
    };
  } else {
    fixture = await createGeneratedSecurityApp("sqlite", STARTUP_PROBE_OPTIONS, {
      parentDirectory: scratch,
    });
  }
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
    SESSION_SECRET: "m3b2-startup-probe-fixed-fixture-secret",
  };
  const target = join(fixture.app, "src/qualification");
  await mkdir(target);
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
      classification: observed?.classification ?? item.classification,
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
    assert.equal(entries.length, 0, "Fixture cleanup must remove every directory it created");
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
