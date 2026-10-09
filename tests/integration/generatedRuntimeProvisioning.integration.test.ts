import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../packages/strata-starter/src/parseArgs.ts";

const root = join(import.meta.dir, "../..");
test.skipIf(!process.env.MIGRATION_DATABASE_URL)(
  "generated production/staging HTTP boots with only a restricted Postgres role",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "strata-runtime-"));
    const id = crypto.randomUUID().replaceAll("-", "");
    const name = `runtime_${id}`;
    const role = `runtime_role_${id}`;
    const password = crypto.randomUUID();
    const control = new SQL(process.env.MIGRATION_DATABASE_URL!);
    let owner: SQL | undefined;
    let created = false;
    let roleCreated = false;
    try {
      await control.unsafe(
        `CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN PASSWORD '${password}'`,
      );
      roleCreated = true;
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const url = new URL(process.env.MIGRATION_DATABASE_URL!);
      url.pathname = `/${name}`;
      owner = new SQL(url.href);
      const app = join(dir, "app");
      generateProject({
        projectName: "runtime",
        targetDir: app,
        layers: layersFromFlags(
          parseCreateStrataArgs(["runtime", "--database=postgres", "--tenancy=rls", "--yes"]),
        ),
        templateRoot: resolveTemplateRoot(),
        overlayRoot: resolveOverlayRoot(),
      });
      await symlink(join(root, "node_modules"), join(app, "node_modules"));
      const schema = (await import(join(app, "src/db/migrations/0001_starter_schema.ts"))).default;
      await schema.up(owner);
      await owner.unsafe(
        `GRANT CONNECT ON DATABASE ${name} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
      );
      // Fault injection: accidental admin provisioning must fail BEFORE it could alter shared roles.
      const helper = join(app, "src/bootstrap/ensureDatabase.ts");
      await Bun.write(
        helper,
        (await readFile(helper, "utf8")).replace(
          '"@getstrata/core/tenant/enableTenantRls"',
          '"./denyProvisioning.ts"',
        ),
      );
      await Bun.write(
        join(app, "src/bootstrap/denyProvisioning.ts"),
        'export const POSTGRES_APP_ROLE_PASSWORD="dev-strata-app-change-me"; export async function ensurePostgresDatabaseAndAppRole(){throw new Error("Unexpected runtime provisioning");}',
      );
      await Bun.write(
        join(app, "probe.ts"),
        `import {strict as assert} from "node:assert";
import {bootstrapApp,createAppServer} from "./src/bootstrap/createApp.ts";
import {closeDatabase,getSql} from "./src/bootstrap/database.ts";
import {LifecycleCoordinator} from "@getstrata/core/lifecycle/gracefulShutdown";
assert.equal(process.env.MIGRATION_DATABASE_URL,undefined,"No admin credential defaults");
assert.equal(process.env.STRATA_APP_PASSWORD,undefined);
const app=await bootstrapApp(); const lifecycle=new LifecycleCoordinator(); const server=createAppServer(app.routes,0,lifecycle);
try {
 const response=await fetch("http://127.0.0.1:"+server.port+"/ready"); assert.equal(response.status,200);
 const [role]=await getSql().unsafe("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"); assert.equal(role.rolsuper,false); assert.equal(role.rolbypassrls,false);
} finally {
 lifecycle.register("drain",()=>app.context.drain(),"drain"); lifecycle.register("flush",()=>app.context.flush(),"flush"); lifecycle.register("close",()=>app.context.dispose(),"close"); lifecycle.register("database",closeDatabase,"close");
 assert.equal((await lifecycle.shutdown("MANUAL")).successful,true);
}`,
      );
      url.username = role;
      url.password = password;
      for (const mode of ["production", "staging"]) {
        const env: Record<string, string | undefined> = {
          PATH: process.env.PATH,
          SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
          APP_ENV: mode,
          NODE_ENV: mode,
          DATABASE_URL: url.href,
          APP_URL: "https://runtime.example.test",
          AUTH_DEV_HEADERS: "false",
          TENANT_DEV_HEADERS: "false",
          TENANCY_DRIVER: "rls",
          CACHE_DRIVER: "array",
          QUEUE_DRIVER: "sync",
          MAIL_DRIVER: "log",
          FEATURE_PUBLIC_READS: "false",
          FEATURE_API_TOKENS: "false",
          FEATURE_SCIM: "false",
          FEATURE_MFA: "false",
          FEATURE_OAUTH: "false",
          FEATURE_BILLING: "false",
          FEATURE_SAML: "false",
          FEATURE_EMAIL_VERIFICATION: "false",
        };
        for (const key of ["APP_DATABASE_URL", "MIGRATION_DATABASE_URL", "STRATA_APP_PASSWORD"])
          delete env[key];
        if (mode === "staging") {
          env.APP_DATABASE_URL = url.href;
          const missing = new URL(url.href);
          missing.pathname = `/missing_${id}`;
          env.DATABASE_URL = missing.href;
        }
        const child = Bun.spawn(["bun", join(app, "probe.ts")], {
          cwd: app,
          env,
          stdout: "pipe",
          timeout: 10000,
          killSignal: "SIGKILL",
          stderr: "pipe",
        });
        const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
        const runtime = new SQL(url.href);
        try {
          expect((await runtime.unsafe("SELECT 1 AS ok"))[0].ok).toBe(1);
        } finally {
          await runtime.close();
        }
      }
      expect((await owner.unsafe("SELECT count(*)::int AS count FROM notes"))[0].count).toBe(0);
    } finally {
      await owner?.close();
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      if (roleCreated) await control.unsafe(`DROP ROLE ${role}`);
      await control.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  30000,
);
