import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

for (const database of ["postgres", "mysql"] as const)
  test(`${database} runtime resolution never provisions production/staging`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "strata-runtime-db-"));
    dirs.push(parent);
    const dir = join(parent, "app");
    generateProject({
      projectName: "runtime",
      targetDir: dir,
      layers: layersFromFlags(
        parseCreateStrataArgs(["runtime", `--database=${database}`, "--yes"]),
      ),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });
    const createApp = await readFile(join(dir, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).toContain("ensureAppDatabase({ provision: !isProduction })");
    for (const file of ["migrate", "fresh"])
      expect(await readFile(join(dir, `src/db/${file}.ts`), "utf8")).toContain(
        "ensureAppDatabase({ provision: true })",
      );
    for (const file of ["status", "rollback"])
      expect(await readFile(join(dir, `src/db/${file}.ts`), "utf8")).toContain(
        "ensureAppDatabase({ provision: false })",
      );
    let helper = await readFile(join(dir, "src/bootstrap/ensureDatabase.ts"), "utf8");
    helper = helper
      .replace(
        '"@getstrata/core/runtime/appEnv"',
        JSON.stringify(join(import.meta.dir, "../../../src/core/runtime/appEnv.ts")),
      )
      .replace('"@getstrata/core/tenant/enableTenantRls"', '"./fake.ts"')
      .replace('"mysql2/promise"', '"./fake.ts"');
    await Bun.write(join(dir, "helper.ts"), helper);
    await Bun.write(
      join(dir, "fake.ts"),
      `export const POSTGRES_APP_ROLE_PASSWORD="dev-strata-app-change-me";
export const calls: unknown[]=[];
export async function ensurePostgresDatabaseAndAppRole(options:unknown){calls.push(options);}
export async function createConnection(url:string){calls.push(url);return {async query(sql:string){calls.push(sql);},async end(){calls.push("close");}};}`,
    );
    await Bun.write(
      join(dir, "probe.ts"),
      `import {strict as assert} from "node:assert";
import {ensureAppDatabase} from "./helper.ts";
import {calls} from "./fake.ts";
delete process.env.NODE_ENV;
const url=${JSON.stringify(database === "postgres" ? "postgresql://runtime:secret@localhost/existing" : "mysql://runtime:secret@localhost/existing")};
for (const mode of ["production","staging"]) {
  process.env.APP_ENV=mode; delete process.env.MIGRATION_DATABASE_URL; delete process.env.STRATA_APP_PASSWORD;
  process.env.DATABASE_URL=url; delete process.env.APP_DATABASE_URL;
  assert.equal(await ensureAppDatabase(),url); assert.equal(calls.length,0);
  process.env.APP_DATABASE_URL=url.replace("existing","override");
  assert.equal(await ensureAppDatabase({provision:false}),process.env.APP_DATABASE_URL);
  assert.equal(process.env.DATABASE_URL,process.env.APP_DATABASE_URL); assert.equal(calls.length,0);
  delete process.env.APP_DATABASE_URL; delete process.env.DATABASE_URL;
  await assert.rejects(()=>ensureAppDatabase(),/required in production/);
  process.env.DATABASE_URL=url;
  ${
    database === "postgres"
      ? `await assert.rejects(()=>ensureAppDatabase({provision:true}),/MIGRATION_DATABASE_URL/);
  process.env.MIGRATION_DATABASE_URL=url;
  await assert.rejects(()=>ensureAppDatabase({provision:true}),/STRATA_APP_PASSWORD/);
  process.env.STRATA_APP_PASSWORD="dev-strata-app-change-me";
  await assert.rejects(()=>ensureAppDatabase({provision:true}),/STRATA_APP_PASSWORD/);
  process.env.STRATA_APP_PASSWORD="explicit-private-provisioning-password";`
      : ""
  }
  await ensureAppDatabase({provision:true}); assert.ok(calls.length>0); calls.length=0;
}
process.env.APP_ENV="local"; delete process.env.APP_DATABASE_URL; process.env.DATABASE_URL=url;
await ensureAppDatabase(); assert.ok(calls.length>0);`,
    );
    const child = Bun.spawn(["bun", join(dir, "probe.ts")], {
      cwd: dir,
      stdout: "pipe",
      timeout: 10000,
      killSignal: "SIGKILL",
      stderr: "pipe",
    });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  });
