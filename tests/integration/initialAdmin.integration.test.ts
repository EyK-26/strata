import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { SQL } from "bun";
import type { RowDataPacket } from "mysql2";
import { createPool } from "mysql2/promise";
import { compileStarterFeatures } from "../../packages/strata-starter/src/featurePlan.ts";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../packages/strata-starter/src/parseArgs.ts";
import { renderInitialAdminMigration } from "../../packages/strata-starter/src/renderInitialAdmin.ts";
import { renderStarterSchemaMigration } from "../../packages/strata-starter/src/renderMigrations.ts";
import { candidatePackage } from "../../scripts/candidate-packages.ts";

import { installGeneratedAppDependencies } from "../unit/cli/helpers";

const secret = "independent-private-bootstrap-secret";

async function exercise(
  driver: "sqlite" | "postgres" | "mysql",
  db: MigrationDatabase,
  url: string,
  directory: string,
  runtimeRole?: string,
) {
  const layers = layersFromFlags(
    parseCreateStrataArgs([
      "admin-app",
      "--auth",
      "cookie",
      "--database",
      driver,
      ...(driver === "postgres" ? ["--tenancy", "rls"] : []),
      "--mfa",
      "--email-verification",
      "--yes",
    ]),
  );
  const app = join(directory, "app");
  generateProject({
    projectName: "admin-app",
    targetDir: app,
    layers,
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });
  const manifest = await Bun.file(join(app, "package.json")).json();
  for (const part of ["core", "bootstrap", "cli"] as const)
    manifest.dependencies[`@getstrata/${part}`] = `file:${await candidatePackage(part, directory)}`;
  await Bun.write(join(app, "package.json"), JSON.stringify(manifest));
  installGeneratedAppDependencies(app);
  const evidence = process.env.STRATA_GENERATED_RUNTIME_EVIDENCE_DIR;
  const provenance = evidence
    ? await mkdtemp(join(evidence, "installed-initial-admin-"))
    : undefined;
  if (provenance) {
    await Bun.write(
      join(provenance, "package.json"),
      await Bun.file(join(app, "package.json")).text(),
    );
    await Bun.write(join(provenance, "bun.lock"), await Bun.file(join(app, "bun.lock")).text());
    const installed = Object.fromEntries(
      ["core", "bootstrap", "cli"].map((part) => [
        part,
        createRequire(join(app, "package.json")).resolve(`@getstrata/${part}`),
      ]),
    );
    for (const path of Object.values(installed))
      expect(path.startsWith(join(app, "node_modules/"))).toBe(true);
    await Bun.write(join(provenance, "resolved.json"), JSON.stringify({ app, installed }, null, 2));
  }
  await Bun.write(
    join(app, "schema.ts"),
    renderStarterSchemaMigration(compileStarterFeatures(layers)),
  );
  await Bun.write(
    join(app, "claim.ts"),
    renderInitialAdminMigration(compileStarterFeatures(layers)) ?? "",
  );
  const schema = (await import(join(app, "schema.ts"))).default;
  const claim = (await import(join(app, "claim.ts"))).default;
  await schema.up(db);
  await claim.up(db);
  if (driver === "postgres") {
    if (!runtimeRole) throw new Error("An owned restricted Postgres role is required");
    await db.unsafe(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
    await db.unsafe(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRole}`,
    );
    await db.unsafe(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${runtimeRole}`);
    await db.unsafe("INSERT INTO tenant (slug) VALUES ('approved')");
  }
  const users = "users";
  const claims = "initial_admin_provisioning";
  // Only negative cases observe failures before the real CLI redacts their payloads.
  const commandSource = await Bun.file(join(app, "src/cli/initialAdmin.ts")).text();
  if (provenance) await Bun.write(join(provenance, "initialAdmin.original.ts"), commandSource);
  const observedSource = commandSource
    .replace('from "@getstrata/cli/initialAdmin"', 'from "../../observeInitialAdmin.ts"')
    .replace(
      `await db.execute({text:"INSERT INTO ${claims}`,
      `console.error("fixture.stage:claim");\n          await db.execute({text:"INSERT INTO ${claims}`,
    )
    .replace(
      `await db.execute({text:"INSERT INTO ${users} (`,
      `console.error("fixture.stage:user-insert");\n          await db.execute({text:"INSERT INTO ${users} (`,
    );
  expect(observedSource).not.toBe(commandSource);
  if (provenance) await Bun.write(join(provenance, "initialAdmin.observed.ts"), observedSource);
  await Bun.write(join(app, "src/cli/observedInitialAdmin.ts"), observedSource);
  await Bun.write(
    join(app, "observeInitialAdmin.ts"),
    `
import { runInitialAdminCommand as realCommand, type InitialAdminOptions } from "@getstrata/cli/initialAdmin";
export async function runInitialAdminCommand(args:string[],options:InitialAdminOptions) {
  return realCommand(args,{...options,provision:async input=>{
    try { await options.provision(input); }
    catch(error) {
      const messages:string[]=[];
      let current:unknown=error;
      for(let depth=0;depth<8 && current instanceof Error;depth++) {
        messages.push(current.message);
        current=current.cause;
      }
      const message=messages.join("\\n");
      const code=message.includes("account already exists")?"duplicate-account":
        message.includes("admin already exists")?"existing-admin":
        message.includes("tenant does not exist")?"missing-tenant":
        message.includes("fixture failure")||message.includes("constraint 'fail'")||message.includes("_fail")?"injected-sql":
        /UNIQUE constraint failed|duplicate key|Duplicate entry/i.test(message)?"unique-conflict":
        message.includes("Production startup blocked")?"startup-secrets":"unexpected";
      console.error("fixture.cause:"+code);
      throw error;
    }
  }});
}`,
  );
  if (provenance)
    await Bun.write(
      join(provenance, "observeInitialAdmin.ts"),
      await Bun.file(join(app, "observeInitialAdmin.ts")).text(),
    );
  await Bun.write(
    join(app, "run.ts"),
    'const { initialAdminCommand } = await import(process.env.FIXTURE_OBSERVE_FAILURE === "true" ? "./src/cli/observedInitialAdmin.ts" : "./src/cli/initialAdmin.ts"); await initialAdminCommand(...process.argv.slice(2));',
  );
  async function command(
    email: string,
    password = secret,
    tenant = driver === "postgres" ? "1" : undefined,
    observe = true,
  ) {
    const process = Bun.spawn(
      [
        "bun",
        "run.ts",
        "--email",
        email,
        "--name",
        "Initial Operator",
        "--password-stdin",
        ...(tenant ? ["--tenant", tenant] : []),
      ],
      {
        cwd: app,
        env: {
          PATH: globalThis.process.env.PATH,
          FIXTURE_OBSERVE_FAILURE: String(observe),
          SESSION_SECRET: `fixture-initial-admin-session-secret-${"x".repeat(32)}`,
          AUTH_DEV_HEADERS: "false",
          TENANT_DEV_HEADERS: "false",
          APP_URL: "https://initial-admin.example.test",
          FRONTEND_MODE: "api",
          CACHE_DRIVER: "array",
          QUEUE_DRIVER: "sync",
          MAIL_DRIVER: "log",
          DATABASE_URL: url,
          APP_DATABASE_URL: url,
          DB_CONNECTION: driver === "postgres" ? "pgsql" : driver,
          TENANCY_DRIVER: driver === "postgres" ? "rls" : "none",
          APP_ENV: "production",
        },
        timeout: 10000,
        killSignal: "SIGKILL",
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    process.stdin.write(`${password}\n`);
    process.stdin.end();
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(stdout + stderr).not.toContain(password);
    return { code, stdout, stderr };
  }
  const adminLiteral = driver === "postgres" ? "TRUE" : "1";
  const ph = driver === "postgres" ? "$1" : "?";
  // A duplicate member is never promoted; the claim rolls back with the refusal.
  await db.unsafe(
    `INSERT INTO ${users} (name,email,password,is_admin${driver === "postgres" ? ",tenant_id" : ""}) VALUES ('Member','member@example.test','unchanged',${driver === "postgres" ? "FALSE,1" : "0"})`,
  );
  const member = await command("MEMBER@example.test");
  expect(member.code).not.toBe(0);
  expect(member.stderr).toContain("fixture.cause:duplicate-account");
  expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
  expect(
    (
      await db.unsafe<{ password: string }>(
        `SELECT password FROM ${users} WHERE email='member@example.test'`,
      )
    )[0]?.password,
  ).toBe("unchanged");
  if (driver === "postgres") {
    const missingTenant = await command("first@example.test", secret, "999");
    expect(missingTenant.code).not.toBe(0);
    expect(missingTenant.stderr).toContain("fixture.cause:missing-tenant");
    expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
    // An existing admin in another tenant must be visible to trusted provisioning bypass.
    await db.unsafe("INSERT INTO tenant (slug) VALUES ('other')");
    await db.unsafe(
      "INSERT INTO users (name,email,password,is_admin,tenant_id) VALUES ('Other','other@example.test','unchanged',TRUE,2)",
    );
    const existingAdmin = await command("first@example.test");
    expect(existingAdmin.code).not.toBe(0);
    expect(existingAdmin.stderr).toContain("fixture.cause:existing-admin");
    expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
    await db.unsafe("DELETE FROM users WHERE email='other@example.test'");
  } else {
    await db.unsafe(
      `INSERT INTO ${users} (name,email,password,is_admin) VALUES ('Other','other@example.test','unchanged',1)`,
    );
    const existingAdmin = await command("first@example.test");
    expect(existingAdmin.code).not.toBe(0);
    expect(existingAdmin.stderr).toContain("fixture.cause:existing-admin");
    expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
    await db.unsafe(`DELETE FROM ${users} WHERE email='other@example.test'`);
  }
  // A SQL failure after claim acquisition must roll the claim back too.
  if (driver === "postgres") {
    await db.unsafe(
      "CREATE FUNCTION fail_admin_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.email = 'fail@example.test' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$",
    );
    await db.unsafe(
      `CREATE TRIGGER fail_admin_insert BEFORE INSERT ON ${users} FOR EACH ROW EXECUTE FUNCTION fail_admin_insert()`,
    );
  } else if (driver === "sqlite") {
    await db.unsafe(
      `CREATE TRIGGER fail_admin_insert BEFORE INSERT ON ${users} WHEN NEW.email='fail@example.test' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
    );
  } else {
    await db.unsafe(
      `ALTER TABLE ${users} ADD CONSTRAINT fail CHECK (email <> 'fail@example.test')`,
    );
  }
  const injected = await command("fail@example.test");
  expect(injected.code).not.toBe(0);
  expect(injected.stderr).toContain("fixture.stage:user-insert");
  expect(injected.stderr).toContain("fixture.cause:injected-sql");
  expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
  // A completed claim rejects admission independently of the admin account's existence.
  await db.unsafe(`INSERT INTO ${claims} (id,email) VALUES (1,${ph})`, ["prior@example.test"]);
  const completed = await command("blocked@example.test");
  expect(completed.code).not.toBe(0);
  expect(completed.stderr).toContain("fixture.stage:claim");
  expect(completed.stderr).toContain("fixture.cause:unique-conflict");
  await db.unsafe(`DELETE FROM ${claims}`);
  const results = await Promise.all([
    command("first@example.test", secret, driver === "postgres" ? "1" : undefined, false),
    command("second@example.test", secret, driver === "postgres" ? "1" : undefined, false),
  ]);
  expect(results.map((result) => result.code === 0).filter(Boolean)).toHaveLength(1);
  const admins = await db.unsafe<{
    email: string;
    password: string;
    email_verified_at: unknown;
    mfa_enabled: unknown;
  }>(
    `SELECT email,password,email_verified_at,mfa_enabled FROM ${users} WHERE is_admin=${adminLiteral}`,
  );
  expect(admins).toHaveLength(1);
  expect(await Bun.password.verify(secret, admins[0]?.password ?? "")).toBe(true);
  expect(admins[0]?.email_verified_at).toBeNull();
  expect(Number(admins[0]?.mfa_enabled)).toBe(0);
  expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([{ id: 1 }]);
  await expect(claim.down(db)).rejects.toThrow("Cannot discard");
  // Deleting the account does not rearm the one-time provisioning command.
  await db.unsafe(`DELETE FROM ${users} WHERE is_admin=${adminLiteral}`);
  const removedAdmin = await command("third@example.test");
  expect(removedAdmin.code).not.toBe(0);
  expect(removedAdmin.stderr).toContain("fixture.stage:claim");
  expect(removedAdmin.stderr).toContain("fixture.cause:unique-conflict");
  expect(await db.unsafe(`SELECT id FROM ${users} WHERE is_admin=${adminLiteral}`)).toEqual([]);
}

test("generated initial-admin command enforces atomic one-time provisioning on SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-admin-sqlite-"));
  const url = join(directory, "app.sqlite");
  const sqlite = new Database(url, { create: true });
  const db: MigrationDatabase = {
    async unsafe<T>(query: string, params: readonly unknown[] = []) {
      const statement = sqlite.query(query);
      if (/^SELECT/i.test(query)) return statement.all(...(params as never[])) as T[];
      statement.run(...(params as never[]));
      return [];
    },
  };
  try {
    await exercise("sqlite", db, url, directory);
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test.skipIf(!process.env.MIGRATION_DATABASE_URL)(
  "generated initial-admin command uses a restricted Postgres role and trusted RLS scope",
  async () => {
    const control = new SQL(process.env.MIGRATION_DATABASE_URL ?? "");
    const name = `admin_bootstrap_${crypto.randomUUID().replaceAll("-", "")}`;
    const directory = await mkdtemp(join(tmpdir(), "strata-admin-pg-"));
    const role = `admin_role_${crypto.randomUUID().replaceAll("-", "")}`;
    const password = crypto.randomUUID();
    let roleCreated = false;
    let database: SQL | undefined;
    try {
      await control.unsafe(
        `CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN PASSWORD '${password}'`,
      );
      roleCreated = true;
      await control.unsafe(`CREATE DATABASE ${name}`);
      const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
      ownerUrl.pathname = `/${name}`;
      database = new SQL(ownerUrl.href);
      const runtimeUrl = new URL(ownerUrl.href);
      runtimeUrl.username = role;
      runtimeUrl.password = password;
      runtimeUrl.pathname = `/${name}`;
      await database.unsafe(`GRANT CONNECT ON DATABASE ${name} TO ${role}`);
      const runtime = new SQL(runtimeUrl.href);
      try {
        const [actual] = await runtime.unsafe(
          "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        );
        expect(actual).toMatchObject({ role, rolsuper: false, rolbypassrls: false });
      } finally {
        await runtime.close();
      }
      await exercise("postgres", database, runtimeUrl.href, directory, role);
    } finally {
      await database?.close();
      await control.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      if (roleCreated) await control.unsafe(`DROP ROLE ${role}`);
      await control.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  25_000,
);

test.skipIf(!process.env.MYSQL_OBSERVABILITY_ADMIN_URL)(
  "generated initial-admin command enforces atomic one-time provisioning on MySQL",
  async () => {
    const control = createPool(process.env.MYSQL_OBSERVABILITY_ADMIN_URL ?? "");
    const name = `admin_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const password = crypto.randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "strata-admin-mysql-"));
    let owner: ReturnType<typeof createPool> | undefined;
    let created = false,
      userCreated = false;
    try {
      await control.query(`CREATE DATABASE ${name}`);
      created = true;
      await control.query(`CREATE USER '${name}'@'%' IDENTIFIED BY ?`, [password]);
      userCreated = true;
      await control.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${name}.* TO '${name}'@'%'`);
      const ownerUrl = new URL(process.env.MYSQL_OBSERVABILITY_ADMIN_URL ?? "");
      ownerUrl.pathname = `/${name}`;
      owner = createPool(ownerUrl.href);
      const db: MigrationDatabase = {
        async unsafe<T>(query: string, params: readonly unknown[] = []) {
          if (!owner) throw new Error("Missing owned MySQL pool");
          const [rows] = await owner.query(query, [...params]);
          return Array.isArray(rows) ? (rows as T[]) : [];
        },
      };
      const runtimeUrl = new URL(ownerUrl.href);
      runtimeUrl.username = name;
      runtimeUrl.password = password;
      const runtime = createPool(runtimeUrl.href);
      try {
        const [identity] = await runtime.query<(RowDataPacket & { actor: string; db: string })[]>(
          "SELECT CURRENT_USER() AS actor, DATABASE() AS db",
        );
        expect(identity.map(({ actor, db }) => ({ actor, db }))).toEqual([
          { actor: `${name}@%`, db: name },
        ]);
        await expect(
          runtime.query("CREATE TABLE forbidden_runtime_ddl (id INTEGER)"),
        ).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
      } finally {
        await runtime.end();
      }
      await exercise("mysql", db, runtimeUrl.href, directory);
    } finally {
      await owner?.end();
      if (created) await control.query(`DROP DATABASE ${name}`);
      if (userCreated) await control.query(`DROP USER '${name}'@'%'`);
      await control.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
  25000,
);
