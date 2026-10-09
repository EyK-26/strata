import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { SQL } from "bun";
import { createPool } from "mysql2/promise";
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
import { renderStarterSchemaMigration } from "../../packages/strata-starter/src/renderRuntime.ts";

const root = join(import.meta.dir, "../..");
const secret = "independent-private-bootstrap-secret";

async function exercise(
  driver: "sqlite" | "postgres" | "mysql",
  db: MigrationDatabase,
  url: string,
  directory: string,
  prefix = "",
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
  await symlink(join(root, "node_modules"), join(app, "node_modules"));
  const identifiers = [
    "initial_admin_provisioning",
    "auth_one_time_tokens",
    "failed_job",
    "users",
    "notes",
    "sessions",
    "tenant",
  ];
  const rewrite = (text: string) =>
    prefix
      ? text.replace(
          new RegExp(`\\b(${identifiers.join("|")})\\b`, "g"),
          (value) => `${prefix}${value}`,
        )
      : text;
  await Bun.write(join(app, "schema.ts"), rewrite(renderStarterSchemaMigration(layers)));
  await Bun.write(join(app, "claim.ts"), rewrite(renderInitialAdminMigration(layers) ?? ""));
  await Bun.write(
    join(app, "src/cli/initialAdmin.ts"),
    rewrite(await Bun.file(join(app, "src/cli/initialAdmin.ts")).text()),
  );
  const schema = (await import(join(app, "schema.ts"))).default;
  const claim = (await import(join(app, "claim.ts"))).default;
  await schema.up(db);
  await claim.up(db);
  if (driver === "postgres") {
    await db.unsafe("GRANT USAGE ON SCHEMA public TO strata_app");
    await db.unsafe(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO strata_app",
    );
    await db.unsafe("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO strata_app");
    await db.unsafe("INSERT INTO tenant (slug) VALUES ('approved')");
  }
  const users = `${prefix}users`;
  const claims = `${prefix}initial_admin_provisioning`;
  await Bun.write(
    join(app, "run.ts"),
    'import { initialAdminCommand } from "./src/cli/initialAdmin.ts"; await initialAdminCommand(...process.argv.slice(2));',
  );
  async function command(
    email: string,
    password = secret,
    tenant = driver === "postgres" ? "1" : undefined,
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
          ...globalThis.process.env,
          DATABASE_URL: url,
          APP_DATABASE_URL: url,
          DB_CONNECTION: driver === "postgres" ? "pgsql" : driver,
          TENANCY_DRIVER: driver === "postgres" ? "rls" : "none",
          APP_ENV: "production",
        },
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
  expect((await command("MEMBER@example.test")).code).not.toBe(0);
  expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
  expect(
    (
      await db.unsafe<{ password: string }>(
        `SELECT password FROM ${users} WHERE email='member@example.test'`,
      )
    )[0]?.password,
  ).toBe("unchanged");
  if (driver === "postgres") {
    expect((await command("first@example.test", secret, "999")).code).not.toBe(0);
    expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
    // An existing admin in another tenant must be visible to trusted provisioning bypass.
    await db.unsafe("INSERT INTO tenant (slug) VALUES ('other')");
    await db.unsafe(
      "INSERT INTO users (name,email,password,is_admin,tenant_id) VALUES ('Other','other@example.test','unchanged',TRUE,2)",
    );
    expect((await command("first@example.test")).code).not.toBe(0);
    expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
    await db.unsafe("DELETE FROM users WHERE email='other@example.test'");
  } else {
    await db.unsafe(
      `INSERT INTO ${users} (name,email,password,is_admin) VALUES ('Other','other@example.test','unchanged',1)`,
    );
    expect((await command("first@example.test")).code).not.toBe(0);
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
      `ALTER TABLE ${users} ADD CONSTRAINT ${prefix}fail CHECK (email <> 'fail@example.test')`,
    );
  }
  expect((await command("fail@example.test")).code).not.toBe(0);
  expect(await db.unsafe(`SELECT id FROM ${claims}`)).toEqual([]);
  // A completed claim rejects admission independently of the admin account's existence.
  await db.unsafe(`INSERT INTO ${claims} (id,email) VALUES (1,${ph})`, ["prior@example.test"]);
  expect((await command("blocked@example.test")).code).not.toBe(0);
  await db.unsafe(`DELETE FROM ${claims}`);
  const results = await Promise.all([
    command("first@example.test"),
    command("second@example.test"),
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
  expect((await command("third@example.test")).code).not.toBe(0);
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
    let database: SQL | undefined;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
      ownerUrl.pathname = `/${name}`;
      database = new SQL(ownerUrl.href);
      const runtimeUrl = new URL(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
      runtimeUrl.pathname = `/${name}`;
      expect(runtimeUrl.username).toBe("strata_app");
      await exercise("postgres", database, runtimeUrl.href, directory);
    } finally {
      await database?.close();
      await control.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await control.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  25_000,
);

test.skipIf(!process.env.MYSQL_URL)(
  "generated initial-admin command enforces atomic one-time provisioning on MySQL",
  async () => {
    const pool = createPool(process.env.MYSQL_URL ?? "");
    const prefix = `admin_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}_`;
    const directory = await mkdtemp(join(tmpdir(), "strata-admin-mysql-"));
    const db: MigrationDatabase = {
      async unsafe<T>(query: string, params: readonly unknown[] = []) {
        const [rows] = await pool.query(query, [...params]);
        return Array.isArray(rows) ? (rows as T[]) : [];
      },
    };
    try {
      await exercise("mysql", db, process.env.MYSQL_URL ?? "", directory, prefix);
    } finally {
      for (const table of [
        "initial_admin_provisioning",
        "auth_one_time_tokens",
        "sessions",
        "notes",
        "users",
        "failed_job",
        "tenant",
      ])
        await pool.query(`DROP TABLE IF EXISTS ${prefix}${table}`);
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
  25_000,
);
