import { SQL } from "bun";
import { quoteSqlLiteral } from "../../src/core/tenant/postgresAppRole.ts";

export async function postgresIdentity(sql: Pick<SQL, "unsafe">) {
  const [identity] = await sql.unsafe(`SELECT current_database() AS database,
    session_user, current_user, current_setting('server_version_num')::int AS version,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls, r.rolinherit, r.rolcanlogin,
    pg_get_userbyid(d.datdba) AS database_owner, pg_get_userbyid(n.nspowner) AS schema_owner,
    n.nspacl::text AS schema_acl,
    has_schema_privilege(current_user,'public','USAGE') AS schema_usage,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create,
    has_table_privilege(current_user,'pg_catalog.pg_authid','UPDATE') AS catalog_update
    FROM pg_roles r CROSS JOIN pg_database d CROSS JOIN pg_namespace n
    WHERE r.rolname=current_user AND d.datname=current_database() AND n.nspname='public'`);
  if (!identity) throw new Error("Missing live PostgreSQL identity.");
  return identity;
}

export async function postgresSchemaAcl(sql: SQL) {
  return sql.unsafe(`SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
    pg_get_userbyid(a.grantor) AS grantor, a.privilege_type, a.is_grantable
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname='public' ORDER BY grantee, privilege_type`);
}

export function postgresFailureCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { errno?: unknown; code?: unknown };
  return typeof value.errno === "string"
    ? value.errno
    : typeof value.code === "string"
      ? value.code
      : null;
}

export async function capturePostgresFailure(work: () => Promise<unknown>) {
  try {
    await work();
    return null;
  } catch (error) {
    return postgresFailureCode(error);
  }
}

/** Only fixture-owned cluster objects; never changes a shared application role/database. */
export async function withPostgresProvisioningFixture<T>(
  work: (fixture: {
    databases: readonly [string, string];
    ownerRole: string;
    creatorRole: string;
    runtimeRole: string;
    password: string;
    admin: SQL;
    owner: SQL;
    creator: SQL;
    runtime: SQL;
    connection: (role: string, database?: string) => SQL;
    ownRole: (name: string) => void;
  }) => Promise<T>,
): Promise<T> {
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) throw new Error("An explicit disposable PostgreSQL administrator URL is required.");
  const base = new URL(raw);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
    throw new Error(
      "Provisioning fixtures require a loopback test server, not a managed/provider connection.",
    );
  base.pathname = "/postgres";
  const control = new SQL({ url: base.href, max: 1 });
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const databases = [`strata_perm_a_${suffix}`, `strata_perm_b_${suffix}`] as const;
  const ownerRole = `strata_perm_owner_${suffix}`;
  const creatorRole = `strata_perm_creator_${suffix}`;
  const runtimeRole = `strata_perm_app_${suffix}`;
  const password = `Owned-${crypto.randomUUID()}`;
  const ownedRoles: string[] = [];
  const ownedDatabases: string[] = [];
  const clients: SQL[] = [];
  function ownRole(name: string) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name) || !name.includes(suffix))
      throw new Error("Role does not belong to this fixture.");
    ownedRoles.push(name);
  }
  function connection(role: string, database: string = databases[0]): SQL {
    const url = new URL(base);
    url.pathname = `/${database}`;
    if (role !== base.username) {
      url.username = role;
      url.password = password;
    }
    const sql = new SQL({ url: url.href, max: 2, connectionTimeout: 5 });
    clients.push(sql);
    return sql;
  }
  let failure: unknown;
  let result: T | undefined;
  try {
    for (const [role, attributes] of [
      [ownerRole, "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"],
      [creatorRole, "NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOBYPASSRLS"],
      [runtimeRole, "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"],
    ]) {
      if (!role) throw new Error("Missing owned role.");
      await control.unsafe(
        `CREATE ROLE ${role} LOGIN PASSWORD ${quoteSqlLiteral(password)} ${attributes}`,
      );
      ownRole(role);
    }
    for (const database of databases) {
      await control.unsafe(`CREATE DATABASE ${database} OWNER ${ownerRole}`);
      ownedDatabases.push(database);
    }
    result = await work({
      databases,
      ownerRole,
      creatorRole,
      runtimeRole,
      password,
      admin: connection(base.username),
      owner: connection(ownerRole),
      creator: connection(creatorRole),
      runtime: connection(runtimeRole),
      connection,
      ownRole,
    });
  } catch (error) {
    failure = error;
  } finally {
    const cleanupFailures: unknown[] = [];
    for (const client of clients)
      try {
        await client.close({ timeout: 1 });
      } catch (error) {
        cleanupFailures.push(error);
      }
    for (const database of ownedDatabases.reverse())
      try {
        await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
      } catch (error) {
        cleanupFailures.push(error);
      }
    for (const role of ownedRoles.reverse())
      try {
        await control.unsafe(`DROP ROLE IF EXISTS ${role}`);
      } catch (error) {
        cleanupFailures.push(error);
      }
    try {
      await control.close({ timeout: 1 });
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length)
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...cleanupFailures],
        "Provisioning test and owned cleanup failed.",
      );
  }
  if (failure) throw failure;
  return result as T;
}
