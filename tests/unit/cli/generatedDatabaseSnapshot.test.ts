import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs";

const root = resolve(import.meta.dir, "../../..");
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("generated migration and runtime share root-anchored SQLite paths from a different cwd", async () => {
  const parent = await mkdtemp(join(tmpdir(), "strata-database-snapshot-"));
  directories.push(parent);
  const directory = join(parent, "app");
  generateProject({
    projectName: "snapshot",
    targetDir: directory,
    layers: layersFromFlags(
      parseCreateStrataArgs(["snapshot", "--database=sqlite", "--auth=headers", "--yes"]),
    ),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });
  const config = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"));
  for (const [alias, paths] of Object.entries(config.compilerOptions.paths))
    config.compilerOptions.paths[alias] = (paths as string[]).map((path) => resolve(root, path));
  config.compilerOptions.paths["@getstrata/core/database/migrations"] = [
    join(root, "src/core/database/migrations/runner.ts"),
  ];
  await writeFile(join(directory, "probe-tsconfig.json"), JSON.stringify(config));
  await writeFile(
    join(directory, "probe.ts"),
    `import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { databaseOptions } from "./src/bootstrap/database.ts";
import { createApplication } from "@getstrata/core/runtime/application";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { join } from "node:path";
import { migrate, seed } from "./src/db/migrate.ts";
import { fresh } from "./src/db/fresh.ts";
import { status } from "./src/db/status.ts";
import { rollback } from "./src/db/rollback.ts";
import { withMigrationDatabase } from "./src/db/migrationRuntime.ts";
const selected = join(import.meta.dir,"custom","selected.sqlite"), unexpected = join(import.meta.dir,"unexpected.sqlite");
const snapshot = Object.freeze({APP_ENV:"local",DATABASE_URL:"sqlite:./custom/selected.sqlite"});
assert.notEqual(process.cwd(),import.meta.dir);
assert.deepEqual(databaseOptions(snapshot),{driver:"sqlite",filename:selected});
process.env.DATABASE_URL="sqlite:"+unexpected;
process.env.APP_ENV="production";
await migrate(snapshot);
await seed(snapshot);
await status(snapshot);
const runtime=createApplication({providers:[],services:createDatabaseBindings({default:"main",connections:{main:databaseOptions(snapshot)}})});
try {
 await runtime.start();
 await runtime.run(async scope=>{const rows=await scope.resolve(DATABASE_SESSION_TOKEN).execute({text:"SELECT COUNT(*) AS count FROM notes",params:[]});assert.equal(rows[0]?.count,1);});
} finally { assert.equal((await runtime.stop()).successful,true); }
await withMigrationDatabase(async db => { const rows = await db.unsafe<{count:number}>("SELECT COUNT(*) AS count FROM notes"); assert.equal(rows[0]?.count,1); }, {environment:snapshot});
await rollback(snapshot);
await fresh(snapshot);
assert.equal(existsSync(selected),true);
assert.equal(existsSync(unexpected),false);
assert.equal(existsSync(join(process.cwd(),"custom","selected.sqlite")),false);
console.log("PASS generated root-anchored database snapshot");
`,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "--tsconfig-override",
      join(directory, "probe-tsconfig.json"),
      join(directory, "probe.ts"),
    ],
    {
      cwd: parent,
      env: { ...process.env, CACHE_DRIVER: "array" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exit, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS generated root-anchored database snapshot");
});

test("CLI migration flags are parsed without being passed as environment arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-migration-flags-"));
  directories.push(directory);
  const entry = join(directory, "entry.ts");
  await writeFile(
    entry,
    `let selected:unknown;
export async function migrate(environment:unknown){if(!environment||typeof environment!=="object")throw new Error("migrate received flags");selected=environment;}
export async function seed(environment:unknown){if(environment!==selected)throw new Error("seed received another snapshot");}
export async function fresh(environment:unknown){if(!environment||typeof environment!=="object")throw new Error("fresh received flags");selected=environment;}`,
  );
  const { migrateCommand, migrateFreshCommand } = await import(
    "../../../packages/strata-cli/src/commands/migrate"
  );
  const application = { root: directory, migrate: entry, fresh: entry };
  await migrateCommand(application, ["--seed"]);
  await migrateFreshCommand(application, ["--seed"]);
});
