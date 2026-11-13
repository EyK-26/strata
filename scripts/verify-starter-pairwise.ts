/** Bounded installed-candidate qualification; never substitutes planning coverage for execution. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../packages/strata-starter/src/generate";
import { starterInstallIdentity } from "../tests/helpers/starterInstallIdentity";
import {
  createStarterPairwiseDatabase,
  starterLocalFixtureUrl,
} from "../tests/helpers/starterPairwiseDatabase";
import { createStarterPairwiseInventory } from "../tests/helpers/starterPairwiseProfiles";
import { candidatePackage } from "./candidate-packages";
import { installerEnvironment } from "./installer-environment";
import { StarterQualificationRoot } from "./starter-qualification-root";

const inventory = createStarterPairwiseInventory();
const root = await mkdtemp(join(tmpdir(), "strata-pairwise-"));
const rootOwner = new StarterQualificationRoot(root);
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
const compileOnly = process.argv.includes("--compile-only");
const records: Array<{ name: string; stages: Record<string, string>; error?: string }> = [];
const receipt = {
  sourceHead: Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
  })
    .stdout.toString()
    .trim(),
  startedAt: new Date().toISOString(),
  finishedAt: "",
  interrupted: false,
  rootDisposition: "owned",
  summary: {} as Record<string, number>,
  kind: "installed-candidate-pairwise-qualification",
  profileSha256: createHash("sha256").update(JSON.stringify(inventory.profiles)).digest("hex"),
  profiles: records,
  limits: {
    concurrency: 2,
    compiler: "installed TypeScript 7",
    frontendBuild: false,
    externalProviders: false,
    mailDelivery: false,
    dockerStartup: false,
    commandTimeoutMs: 90000,
    secretOverrides: ["JWT_SECRET", "TOKEN_HASH_PEPPER"],
    databaseIsolation: "one owned empty database per profile",
  },
  archives: {} as unknown,
};
const runtimeEnv = installerEnvironment();
const children = new Set<ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>>();
let stopping = false;
let unresolvedChild = false;
const terminate = () => {
  stopping = true;
  receipt.interrupted = true;
  process.exitCode = 143;
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGTERM", terminate);
process.once("SIGINT", terminate);
// Application config is constructed separately; never inherit ambient database/provider configuration.
async function joinWorkers(workers: Promise<void>[]) {
  const results = await Promise.allSettled(workers);
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length)
    throw new AggregateError(errors, "Profile workers failed after all workers settled");
}
async function run(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = runtimeEnv,
) {
  assert.ok(!stopping, "Profile qualification interrupted");
  const child = Bun.spawn(args, {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90000,
    killSignal: "SIGKILL",
  });
  children.add(child);
  const results = await Promise.allSettled([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ] as const);
  const [terminal, out, err] = results;
  if (terminal.status === "fulfilled") children.delete(child);
  else {
    unresolvedChild = true;
    child.kill("SIGTERM");
  }
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, "Profile command observation failed");
  assert.ok(terminal.status === "fulfilled");
  const stdout = out.status === "fulfilled" ? out.value : "";
  const stderr = err.status === "fulfilled" ? err.value : "";
  assert.equal(terminal.value, 0, `${args.slice(0, 3).join(" ")}: ${stdout}\n${stderr}`);
}
let saving = Promise.resolve();
function save() {
  const snapshot = `${JSON.stringify(receipt, null, 2)}\n`;
  if (output) saving = saving.then(() => writeFile(output, snapshot));
  return saving;
}
try {
  if (!compileOnly) starterLocalFixtureUrl(process.env.REDIS_URL, ["redis:", "rediss:"]);
  const archives = join(root, "archives");
  await mkdir(archives);
  await rootOwner.prepare(archives);
  process.env.STRATA_TEST_PACKAGE_DIR = archives;
  receipt.archives = JSON.parse(await readFile(join(archives, "manifest.json"), "utf8"));
  const installs = new Map<string, string>();
  const apps: Array<{
    profile: (typeof inventory.profiles)[number];
    record: (typeof records)[number];
    app: string;
  }> = [];
  for (const profile of inventory.profiles) {
    assert.ok(!stopping, "Profile qualification interrupted");
    const record = {
      name: profile.name,
      stages: {
        generation: "pending",
        install: "pending",
        typecheck: "pending",
        migration: "not-run",
        boot: "not-run",
        cleanup: "not-run",
      },
    };
    records.push(record);
    const app = join(root, profile.name);
    generateProject({
      projectName: profile.name,
      targetDir: app,
      layers: profile.layers,
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });
    record.stages.generation = "pass";
    const file = join(app, "package.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    for (const part of ["core", "bootstrap", "cli"] as const)
      manifest.dependencies[`@getstrata/${part}`] = `file:${await candidatePackage(part, root)}`;
    await writeFile(file, JSON.stringify(manifest));
    // Exact semantic equality, including overrides and dev dependencies, before sharing resolution.
    const key = starterInstallIdentity(manifest);
    const existing = installs.get(key);
    if (existing) {
      await symlink(join(existing, "node_modules"), join(app, "node_modules"), "dir");
      record.stages.install = "shared-identical-manifest";
    } else {
      await run([process.execPath, "install", "--prefer-offline"], app);
      installs.set(key, app);
      record.stages.install = "pass";
    }
    apps.push({ profile, app, record });
  }
  let cursor = 0;
  await joinWorkers(
    Array.from({ length: 2 }, async () => {
      while (!stopping && cursor < apps.length) {
        const item = apps[cursor++];
        if (!item) break;
        try {
          await run([process.execPath, "run", "check"], item.app);
          item.record.stages.typecheck = "pass";
        } catch (error) {
          item.record.stages.typecheck = "fail";
          (item.record as (typeof records)[number]).error = String(error);
        }
        await save();
      }
    }),
  );
  if (!compileOnly) {
    // Each profile owns an empty database and restricted runtime role; no cross-profile history.
    let runtimeCursor = 0;
    await joinWorkers(
      Array.from({ length: 2 }, async () => {
        while (!stopping && runtimeCursor < apps.length) {
          const item = apps[runtimeCursor++];
          if (item?.record.stages.typecheck !== "pass") continue;
          const { profile, app, record } = item;
          let fixture: Awaited<ReturnType<typeof createStarterPairwiseDatabase>> | undefined;
          try {
            fixture = await createStarterPairwiseDatabase(profile.layers.database);
            const env: Record<string, string | undefined> = { ...runtimeEnv };
            for (const line of (await readFile(join(app, ".env.example"), "utf8")).split("\n")) {
              const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
              if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2];
            }
            Object.assign(env, {
              DATABASE_URL: fixture.runtimeUrl,
              APP_DATABASE_URL: fixture.runtimeUrl,
              REDIS_URL: process.env.REDIS_URL,
              APP_KEY_PREFIX: `pairwise-${crypto.randomUUID()}`,
              JWT_SECRET: "pairwise-owned-jwt-secret-at-least-32",
              TOKEN_HASH_PEPPER: "pairwise-owned-token-pepper",
              MAIL_HOST: "127.0.0.1",
              MAIL_PORT: "1025",
            });
            await run([process.execPath, "run", "db:migrate"], app, {
              ...env,
              MIGRATION_DATABASE_URL: fixture.migrationUrl,
              STRATA_APP_PASSWORD: process.env.STRATA_APP_PASSWORD,
            });
            record.stages.migration = "pass";
            const probe = join(app, "pairwise-boot.ts");
            await writeFile(
              probe,
              await readFile(
                join(import.meta.dir, "../tests/fixtures/starter-pairwise-boot.ts.txt"),
                "utf8",
              ),
            );
            await run([process.execPath, probe], app, env);
            record.stages.boot = "pass";
          } catch (error) {
            if (record.stages.migration !== "pass") record.stages.migration = "fail";
            else record.stages.boot = "fail";
            (record as (typeof records)[number]).error = String(error);
          } finally {
            if (fixture) {
              try {
                assert.ok(
                  !unresolvedChild,
                  "Unconfirmed command termination; owned database retained",
                );
                await fixture.close();
                record.stages.cleanup = "pass";
              } catch (error) {
                record.stages.cleanup = "fail";
                const row = record as (typeof records)[number];
                row.error = [row.error, String(error)].filter(Boolean).join("\n");
              }
            }
          }
          await save();
        }
      }),
    );
  }

  receipt.summary = {
    generated: records.filter((r) => r.stages.generation === "pass").length,
    installedGraphs: installs.size,
    typechecked: records.filter((r) => r.stages.typecheck === "pass").length,
    migrated: records.filter((r) => r.stages.migration === "pass").length,
    booted: records.filter((r) => r.stages.boot === "pass").length,
  };
  await save();
  const failures = records.filter((record) => record.error);
  console.log(
    JSON.stringify(
      {
        profiles: records.length,
        installedGraphs: installs.size,
        typechecked: records.filter((r) => r.stages.typecheck === "pass").length,
        booted: records.filter((r) => r.stages.boot === "pass").length,
        failures: failures.map((r) => ({ name: r.name, error: r.error })),
        output,
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  receipt.rootDisposition = await rootOwner.cleanup(children.size > 0 || unresolvedChild);
  if (receipt.rootDisposition === "retained")
    console.error(`Unconfirmed child remains; retained qualification root: ${root}`);
  await save();
  process.off("SIGTERM", terminate);
  process.off("SIGINT", terminate);
}
