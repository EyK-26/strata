/** Native resources owned by one profile; no dependency install and no shared schema reset. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { createConnection } from "mysql2/promise";
import { GeneratedSecurityAppOwner } from "./generatedSecurityAppOwner";

export function starterLocalFixtureUrl(
  value: string | undefined,
  protocols: readonly string[],
): URL {
  assert.ok(value, "Native profile qualification requires local fixture credentials");
  const url = new URL(value);
  assert.ok(protocols.includes(url.protocol), "Unexpected local fixture protocol");
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "Only loopback fixtures are allowed",
  );
  return url;
}
export async function createStarterPairwiseDatabase(engine: "sqlite" | "postgres" | "mysql") {
  const databaseName = `generated_security_${crypto.randomUUID().replaceAll("-", "")}`;
  const user = `q01_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const owner = new GeneratedSecurityAppOwner(databaseName, user);
  const setup = (async () => {
    owner.admit();
    const root = await mkdtemp(join(tmpdir(), "strata-pairwise-db-"));
    owner.root = root;
    owner.admit();
    let migrationUrl: string;
    let runtimeUrl: string;
    if (engine === "sqlite") migrationUrl = runtimeUrl = `sqlite:${join(root, "app.sqlite")}`;
    else if (engine === "postgres") {
      const admin = starterLocalFixtureUrl(process.env.MIGRATION_DATABASE_URL, [
        "postgres:",
        "postgresql:",
      ]);
      const runtime = starterLocalFixtureUrl(
        process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL,
        ["postgres:", "postgresql:"],
      );
      const control = new URL(admin);
      control.pathname = "/postgres";
      owner.connectionAttempted = true;
      owner.postgres = new SQL(control.href);
      owner.database = "attempted";
      await owner.postgres.unsafe(`CREATE DATABASE ${databaseName}`);
      owner.database = "acquired";
      owner.admit();
      admin.pathname = runtime.pathname = `/${databaseName}`;
      migrationUrl = admin.href;
      runtimeUrl = runtime.href;
    } else {
      const admin = starterLocalFixtureUrl(process.env.MYSQL_OBSERVABILITY_ADMIN_URL, ["mysql:"]);
      owner.connectionAttempted = true;
      owner.mysql = await createConnection(admin.href);
      owner.admit();
      owner.database = "attempted";
      await owner.mysql.query(`CREATE DATABASE ${databaseName}`);
      owner.database = "acquired";
      owner.admit();
      owner.user = "attempted";
      const password = crypto.randomUUID().replaceAll("-", "");
      await owner.mysql.query(`CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'`);
      owner.user = "acquired";
      owner.admit();
      await owner.mysql.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${databaseName}.* TO '${user}'@'%'`,
      );
      admin.pathname = `/${databaseName}`;
      const runtime = new URL(admin);
      runtime.username = user;
      runtime.password = password;
      migrationUrl = admin.href;
      runtimeUrl = runtime.href;
    }
    return { migrationUrl, runtimeUrl, close: owner.close };
  })();
  try {
    const fixture = await owner.observeSetup(setup);
    owner.handoff();
    return fixture;
  } catch (error) {
    return owner.failSetup(error);
  }
}
