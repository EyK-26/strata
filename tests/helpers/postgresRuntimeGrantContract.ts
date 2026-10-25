import assert from "node:assert/strict";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { migrateDatabase } from "@getstrata/core/database/migrations";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { defineModel, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import {
  ensurePostgresAppRole,
  generatedRlsBootstrapSql,
  grantPostgresAppRolePrivileges,
} from "@getstrata/core/tenant/enableTenantRls";
import { SQL } from "bun";

function sqlState(error: unknown): string {
  if (!(error instanceof Error)) throw error;
  const state = Reflect.get(error, "errno");
  if (typeof state !== "string") throw error;
  return state;
}

/** Every database/role is freshly created by this contract and removed in finally. */
export async function observePostgresRuntimeGrants(
  adminUrl: string,
  options: { legacy?: boolean; delegated?: boolean } = {},
) {
  const id = crypto.randomUUID().replaceAll("-", "");
  const database = `runtime_acl_${id}`,
    role = `runtime_acl_${id}`,
    owner = `migration_acl_${id}`;
  const password = crypto.randomUUID();
  const control = new SQL({ url: adminUrl, max: 1 });
  const clients: SQL[] = [],
    roles: string[] = [];
  let created = false;
  try {
    if (options.delegated) {
      await control.unsafe(
        `CREATE ROLE ${owner} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      roles.push(owner);
    }
    await control.unsafe(
      `CREATE DATABASE ${database}${options.delegated ? ` OWNER ${owner}` : ""}`,
    );
    created = true;
    const target = new URL(adminUrl);
    target.pathname = `/${database}`;
    const admin = new SQL({ url: target.href, max: 1 });
    clients.push(admin);
    if (options.delegated) {
      target.username = owner;
      target.password = password;
    }
    const migration = new SQL({ url: target.href, max: 1 });
    clients.push(migration);
    const migrationDb: Pick<MigrationDatabase, "unsafe"> = {
      async unsafe<T>(query: string, params: readonly unknown[] = []) {
        return migration.unsafe<T[]>(query, [...params]);
      },
    };
    const migrations = [
      {
        name: "001_notes",
        async up(db: Pick<MigrationDatabase, "unsafe">) {
          await db.unsafe(
            `CREATE TABLE tenant (id INTEGER PRIMARY KEY); INSERT INTO tenant VALUES (1),(2); CREATE TABLE notes (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenant(id), body TEXT NOT NULL); ${generatedRlsBootstrapSql(["notes"])}`,
          );
        },
        async down(db: Pick<MigrationDatabase, "unsafe">) {
          await db.unsafe("DROP TABLE notes; DROP TABLE tenant");
        },
      },
      {
        name: "002_later_notes",
        async up(db: Pick<MigrationDatabase, "unsafe">) {
          await db.unsafe(
            `CREATE TABLE later_notes (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenant(id), body TEXT NOT NULL); ${generatedRlsBootstrapSql(["later_notes"])}`,
          );
        },
        async down(db: Pick<MigrationDatabase, "unsafe">) {
          await db.unsafe("DROP TABLE later_notes");
        },
      },
    ];
    await runWithSqlDialect("pgsql", () =>
      migrateDatabase(migrationDb, migrations.slice(0, 1), { advisoryLock: true }),
    );
    await admin.unsafe(
      "INSERT INTO notes(tenant_id,body) VALUES (1,'tenant-one-private'),(2,'tenant-two-private')",
    );
    await control.unsafe(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    roles.push(role);
    const apply = () =>
      options.delegated
        ? grantPostgresAppRolePrivileges(migration, { database, role })
        : ensurePostgresAppRole(admin, { database, role, password });
    let atomicRevokeRollback: boolean | null = null;
    if (options.legacy) {
      await migration.unsafe(
        `GRANT CONNECT ON DATABASE ${database} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${role}; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${role}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${role}`,
      );
      const fault = {
        async unsafe<T>(query: string, params: readonly unknown[] = []) {
          return migration.unsafe<T[]>(`${query}; SELECT 1/0`, [...params]);
        },
      };
      let failure = "";
      try {
        await grantPostgresAppRolePrivileges(fault, { database, role });
      } catch (error) {
        failure = sqlState(error);
      }
      assert.equal(failure, "22012");
      await migration.unsafe("CREATE TABLE rollback_defaults(id SERIAL PRIMARY KEY)");
      const [unchanged] = await admin.unsafe<{ current_acl: boolean; future_acl: boolean }[]>(
        "SELECT has_table_privilege($1,'notes','TRUNCATE') AS current_acl, has_table_privilege($1,'rollback_defaults','TRUNCATE') AS future_acl",
        [role],
      );
      assert.deepEqual(unchanged, { current_acl: true, future_acl: true });
      await migration.unsafe("DROP TABLE rollback_defaults");
      atomicRevokeRollback = true;
    }
    await apply();
    await apply(); // Re-provisioning must not restore maintenance capabilities.
    target.username = role;
    target.password = password;
    const runtime = new SQL({ url: target.href, max: 1 });
    clients.push(runtime);
    const [identity] = await runtime.unsafe<
      {
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
        schema_create: boolean;
      }[]
    >(
      "SELECT current_user,rolsuper,rolbypassrls,rolcreaterole,has_schema_privilege(current_user,'public','CREATE') AS schema_create FROM pg_roles WHERE rolname=current_user",
    );
    const [migrationIdentity] = await migration.unsafe<
      { rolsuper: boolean; rolcreaterole: boolean; schema_create: boolean }[]
    >(
      "SELECT rolsuper,rolcreaterole,has_schema_privilege(current_user,'public','CREATE') AS schema_create FROM pg_roles WHERE rolname=current_user",
    );
    const [server] = await admin.unsafe<{ version: number }[]>(
      "SELECT current_setting('server_version_num')::int AS version",
    );
    assert.ok(server && identity && migrationIdentity);
    const version = server.version;
    async function privileges(table: string) {
      const [row] = await runtime.unsafe<
        {
          select: boolean;
          insert: boolean;
          update: boolean;
          delete: boolean;
          truncate: boolean;
          references: boolean;
          trigger: boolean;
          sequence_usage: boolean;
          sequence_select: boolean;
          sequence_update: boolean;
          maintain: boolean | null;
        }[]
      >(
        `SELECT has_table_privilege(current_user,$1,'SELECT') AS select, has_table_privilege(current_user,$1,'INSERT') AS insert, has_table_privilege(current_user,$1,'UPDATE') AS update, has_table_privilege(current_user,$1,'DELETE') AS delete, has_table_privilege(current_user,$1,'TRUNCATE') AS truncate, has_table_privilege(current_user,$1,'REFERENCES') AS references, has_table_privilege(current_user,$1,'TRIGGER') AS trigger, has_sequence_privilege(current_user,$2,'USAGE') AS sequence_usage, has_sequence_privilege(current_user,$2,'SELECT') AS sequence_select, has_sequence_privilege(current_user,$2,'UPDATE') AS sequence_update, ${version >= 170000 ? "has_table_privilege(current_user,$1,'MAINTAIN')" : "NULL::boolean"} AS maintain`,
        [table, `${table}_id_seq`],
      );
      assert.ok(row);
      return row;
    }
    const sequenceMutationDenial = await runtime.begin(async (tx): Promise<string | null> => {
      const [row] = await tx.unsafe<{ value: number }[]>(
        "SELECT last_value::int AS value FROM notes_id_seq",
      );
      assert.ok(row);
      try {
        await tx.savepoint(async (sp) => {
          await sp.unsafe("SELECT setval('notes_id_seq',$1,true)", [row.value]);
        });
        return null;
      } catch (error) {
        return sqlState(error);
      }
    });
    const current = await privileges("notes");
    const [policy] = await admin.unsafe<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='notes'::regclass");
    assert.ok(policy);
    const crud = await runtime.begin(async (tx) => {
      await tx.unsafe("SELECT set_config('app.tenant_id','1',true)");
      interface NoteRecord {
        id: number;
        tenant_id: number;
        body: string;
      }
      class Note extends defineModel(
        defineTable<NoteRecord>({
          name: "notes",
          primaryKey: "id",
          columns: ["id", "tenant_id", "body"],
        }),
      ) {
        static override $fillable = ["tenant_id", "body"] as const;
        static override $timestamps = false;
      }
      const db: DatabaseConnection = {
        async unsafe<T>(query: string, params: readonly unknown[] = []) {
          return tx.unsafe<T[]>(query, [...params]);
        },
      };
      registerModelRepository(Note, Note.repository().withConnection(db));
      return runWithSqlDialect("pgsql", async () => {
        assert.equal(await Note.find(2), null);
        const note = await Note.create({ tenant_id: 1, body: "Příliš žluťoučký" });
        assert.equal((await Note.find(note.toObject().id))?.toObject().body, "Příliš žluťoučký");
        await note.update({ body: "updated" });
        assert.equal((await Note.find(note.toObject().id))?.toObject().body, "updated");
        await note.delete();
        assert.equal(await Note.find(note.toObject().id), null);
        const [count] = await tx.unsafe<{ count: number }[]>(
          "SELECT count(*)::int AS count FROM notes",
        );
        assert.equal(count?.count, 1);
        let crossTenant = "";
        try {
          await tx.savepoint(async (sp) => {
            await sp.unsafe("INSERT INTO notes(tenant_id,body) VALUES (2,'denied')");
          });
        } catch (error) {
          crossTenant = sqlState(error);
        }
        assert.equal(crossTenant, "42501");
        return true;
      });
    });
    async function truncateProbe(table: string): Promise<{
      denial: string | null;
      otherBefore: number;
      otherAfter: number;
      otherRestored: number | undefined;
      bypass: boolean;
    }> {
      const rollback = new Error("owned truncate rollback");
      let denial: string | null = null,
        otherBefore = -1,
        otherAfter = -1,
        bypass = true;
      try {
        await runtime.begin(async (tx) => {
          await tx.unsafe("SELECT set_config('app.tenant_id','2',true)");
          otherBefore =
            (await tx.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM ${table}`))[0]
              ?.count ?? -1;
          await tx.unsafe("SELECT set_config('app.tenant_id','1',true)");
          bypass =
            (await tx.unsafe<{ bypass: boolean }[]>("SELECT app_bypass_rls() AS bypass"))[0]
              ?.bypass ?? true;
          try {
            await tx.savepoint(async (sp) => {
              await sp.unsafe(`TRUNCATE TABLE ${table}`);
            });
          } catch (error) {
            denial = sqlState(error);
          }
          await tx.unsafe("SELECT set_config('app.tenant_id','2',true)");
          otherAfter =
            (await tx.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM ${table}`))[0]
              ?.count ?? -1;
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      const otherRestored = (
        await admin.unsafe<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM ${table} WHERE tenant_id=2`,
        )
      )[0]?.count;
      return { denial, otherBefore, otherAfter, otherRestored, bypass };
    }
    const currentTruncate = await truncateProbe("notes");
    await runWithSqlDialect("pgsql", () =>
      migrateDatabase(migrationDb, migrations, { advisoryLock: true }),
    );
    await admin.unsafe(
      "INSERT INTO later_notes(tenant_id,body) VALUES (1,'later-one'),(2,'later-two')",
    );
    const future = await privileges("later_notes"),
      futureTruncate = await truncateProbe("later_notes");
    const rollback = new Error("owned maintenance rollback");
    let migrationTruncate = false;
    try {
      await migration.begin(async (tx) => {
        await tx.unsafe("TRUNCATE TABLE notes");
        migrationTruncate = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const [restored] = await admin.unsafe<{ count: number }[]>(
      "SELECT count(*)::int AS count FROM notes",
    );
    assert.equal(restored?.count, 2);
    return {
      version,
      role,
      identity,
      migrationIdentity,
      policy,
      crud,
      current,
      currentTruncate,
      future,
      futureTruncate,
      migrationTruncate,
      sequenceMutationDenial,
      atomicRevokeRollback,
    };
  } finally {
    await Promise.allSettled(clients.map((sql) => sql.close()));
    if (created) await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    for (const role of roles.reverse()) await control.unsafe(`DROP ROLE ${role}`);
    await control.close();
  }
}
