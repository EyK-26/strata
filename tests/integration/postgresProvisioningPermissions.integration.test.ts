import { expect, test } from "bun:test";
import {
  BaseRepository,
  type SqlDatabaseConnection,
} from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { Schema } from "@getstrata/core/database/schema";
import { defineTable } from "@getstrata/core/database/table";
import { createOutboxMigration, SqlOutbox } from "@getstrata/core/events/outbox";
import { FailedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { generatedRlsBootstrapSql } from "@getstrata/core/tenant/enableTenantRls";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { migrateDatabase } from "../../src/core/database/migrations/runner.ts";
import {
  ensurePostgresAppRole,
  grantPostgresAppRolePrivileges,
} from "../../src/core/tenant/postgresAppRole.ts";
import {
  capturePostgresFailure,
  postgresIdentity,
  postgresSchemaAcl,
  withPostgresProvisioningFixture,
} from "../helpers/postgresProvisioningFixture.ts";
import { restoreEnvVar } from "../helpers/restoreEnv.ts";

function evidence(label: string, value: unknown) {
  console.log(`PG_PROVISION_EVIDENCE ${JSON.stringify({ label, value })}`);
}

test("CREATEROLE can manage its roles but cannot acquire Strata's shared catalog lock", async () => {
  await withPostgresProvisioningFixture(async (f) => {
    const identity = await postgresIdentity(f.creator);
    expect(identity.current_user).toBe(f.creatorRole);
    expect(identity.session_user).toBe(f.creatorRole);
    expect(identity.rolsuper).toBe(false);
    expect(identity.rolcreaterole).toBe(true);
    expect(identity.catalog_update).toBe(false);
    const managed = f.creatorRole.replace("creator", "managed");
    f.ownRole(managed);
    await f.creator.unsafe(`CREATE ROLE ${managed} LOGIN`);
    expect(
      (await f.admin.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [managed]))[0].rolname,
    ).toBe(managed);
    const before = await postgresSchemaAcl(f.admin);
    expect(
      await capturePostgresFailure(() =>
        ensurePostgresAppRole(f.creator, {
          database: f.databases[0],
          role: f.runtimeRole,
          password: "Must-not-rotate",
        }),
      ),
    ).toBe("42501");
    expect(await postgresSchemaAcl(f.admin)).toEqual(before);
    const login = f.connection(f.runtimeRole);
    expect((await postgresIdentity(login)).current_user).toBe(f.runtimeRole);
    evidence("createrole-catalog-denied", {
      identity,
      administrator: await postgresIdentity(f.admin),
      sqlState: "42501",
      ordinaryCreateRoleSucceeded: true,
      roleAndAclUnchanged: true,
    });
  });
}, 30000);

test("a database/schema owner without cluster privileges runs public migrations and grant-only ACLs", async () => {
  await withPostgresProvisioningFixture(async (f) => {
    const original = await postgresIdentity(f.owner);
    evidence("owner-before-schema-adoption", original);
    await f.admin.unsafe(
      `ALTER SCHEMA public OWNER TO ${f.ownerRole}; REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
    );
    const identity = await postgresIdentity(f.owner);
    expect(identity.rolsuper).toBe(false);
    expect(identity.rolcreatedb).toBe(false);
    expect(identity.rolcreaterole).toBe(false);
    expect(identity.rolbypassrls).toBe(false);
    const forbidden = f.ownerRole.replace("owner", "forbidden");
    f.ownRole(forbidden);
    expect(await capturePostgresFailure(() => f.owner.unsafe(`CREATE ROLE ${forbidden}`))).toBe(
      "42501",
    );
    const applied = await runWithSqlDialect("pgsql", () =>
      migrateDatabase(
        f.owner,
        [
          {
            name: "owned_schema",
            async up(db) {
              await Schema.run(db, "pgsql", (s) => {
                s.create("owned_items", (t) => {
                  t.id();
                  t.string("value");
                });
              });
            },
            async down(db) {
              await Schema.run(db, "pgsql", (s) => {
                s.drop("owned_items");
              });
            },
          },
        ],
        { advisoryLock: true },
      ),
    );
    expect(applied).toBe(1);
    await grantPostgresAppRolePrivileges(f.owner, {
      database: f.databases[0],
      role: f.runtimeRole,
    });
    await f.owner.unsafe("CREATE TABLE later_items(id SERIAL PRIMARY KEY,value TEXT)");
    await f.runtime.unsafe(
      "INSERT INTO owned_items(value) VALUES ('existing'); INSERT INTO later_items(value) VALUES ('future')",
    );
    expect(
      (await f.runtime.unsafe("SELECT count(*)::int AS count FROM later_items"))[0].count,
    ).toBe(1);
    evidence("owner-migration-without-role-provisioning", {
      identity,
      applied,
      runtime: await postgresIdentity(f.runtime),
      tableGrants: await f.admin.unsafe(
        "SELECT table_schema,table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee=$1 ORDER BY table_name,privilege_type",
        [f.runtimeRole],
      ),
      sequencePrivileges: await f.admin.unsafe(
        "SELECT c.relname AS sequence,has_sequence_privilege($1,c.oid,'USAGE') AS usage,has_sequence_privilege($1,c.oid,'SELECT') AS select,has_sequence_privilege($1,c.oid,'UPDATE') AS update FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE c.relkind='S' AND n.nspname='public' ORDER BY c.relname",
        [f.runtimeRole],
      ),
      defaultAcls: await f.admin.unsafe(
        "SELECT defaclobjtype,defaclacl::text FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname=$1) ORDER BY defaclobjtype",
        [f.ownerRole],
      ),
      existingAndFutureSequenceInserts: true,
    });
  });
}, 30000);

test("runtime HTTP, RLS and queue effects need no schema CREATE after owner migrations", async () => {
  await withPostgresProvisioningFixture(async (f) => {
    await f.admin.unsafe(
      `ALTER SCHEMA public OWNER TO ${f.ownerRole}; REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
    );
    await ensurePostgresAppRole(f.admin, {
      database: f.databases[0],
      role: f.runtimeRole,
      password: f.password,
    });
    await runWithSqlDialect("pgsql", () =>
      migrateDatabase(f.owner, [
        {
          name: "runtime_tables",
          async up(db) {
            await db.unsafe(
              "CREATE TABLE scoped_entries(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,value TEXT NOT NULL); INSERT INTO scoped_entries(tenant_id,value) VALUES(2,'private-two'); CREATE TABLE failed_job(id SERIAL PRIMARY KEY,job_name TEXT NOT NULL,job_id TEXT,payload JSONB NOT NULL,exception TEXT NOT NULL,failed_at TIMESTAMPTZ NOT NULL)",
            );
            await db.unsafe(generatedRlsBootstrapSql(["scoped_entries"]));
          },
          async down(db) {
            await db.unsafe("DROP TABLE failed_job; DROP TABLE scoped_entries");
          },
        },
        createOutboxMigration("outbox", "pgsql", { rls: true }),
      ]),
    );
    await grantPostgresAppRolePrivileges(f.owner, {
      database: f.databases[0],
      role: f.runtimeRole,
    });
    const oldPool = getDefaultDatabasePool();
    const oldBound = getBoundDatabaseConnection();
    const oldTenancy = process.env.TENANCY_DRIVER;
    const tenant = { id: 1, slug: "one" };
    const oldOther = { id: 2, slug: "two" };
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
      process.env.TENANCY_DRIVER = "rls";
      registerDefaultDatabasePool(f.runtime as SqlDatabaseConnection);
      bindDatabaseConnection(f.runtime);
      await runWithSqlDialect("pgsql", async () => {
        const entries = new BaseRepository(
          defineTable<{ id: number; tenant_id: number; value: string }, "id">({
            name: "scoped_entries",
            primaryKey: "id",
            columns: ["id", "tenant_id", "value"],
          }),
        );
        const observed: unknown[] = [];
        const outbox = new SqlOutbox({
          listeners: [
            {
              event: "entry.saved",
              name: "owned-listener",
              async handle(event) {
                observed.push(event.payload);
                expect((await entries.query().get()).every((row) => row.tenant_id === 1)).toBe(
                  true,
                );
              },
            },
          ],
          resolveTenant: async (id) => ({ id, slug: String(id) }),
        });
        server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () =>
            runWithTenantDatabase(tenant, async () => {
              const created = await entries.create({ tenant_id: 1, value: "through-http" });
              await outbox.publish("entry.saved", { id: created.id });
              return Response.json(created);
            }),
        });
        const response = await fetch(server.url);
        expect(response.status).toBe(200);
        const created = (await response.json()) as { id: number };
        expect(Number(created.id)).toBeGreaterThan(0);
        expect(await outbox.processNext()).toBe(true);
        expect(observed).toHaveLength(1);
        await runWithTenantDatabase(tenant, async () => {
          expect((await entries.query().get()).map((row) => row.value)).toEqual(["through-http"]);
          expect(await entries.updateById(Number(created.id), { value: "updated" })).not.toBeNull();
        });
        await expect(
          runWithTenantDatabase(tenant, () =>
            entries.create({ tenant_id: 2, value: "wrong-tenant" }),
          ),
        ).rejects.toThrow();
        await runWithTenantDatabase(oldOther, async () => {
          expect((await entries.query().get()).map((row) => row.value)).toEqual(["private-two"]);
          expect(await entries.findById(Number(created.id))).toBeNull();
        });
        const failures = new FailedJobRepository();
        const failed = await failures.create({
          job_name: "owned",
          job_id: "owned-id",
          payload: { value: "record" },
          exception: "controlled",
          failed_at: new Date(),
        });
        expect(Number(failed.id)).toBeGreaterThan(0);
        expect((await failures.findAll())[0]?.payload).toEqual({ value: "record" });
        await runWithTenantDatabase(tenant, async () => {
          expect(await entries.deleteById(Number(created.id))).toBe(true);
        });
      });
      evidence("runtime-before-ddl-negative", {
        identity: await postgresIdentity(f.runtime),
        acl: await postgresSchemaAcl(f.admin),
        http: true,
        rls: true,
        queueFailurePersistence: true,
        durableWorker: true,
      });
      // A real denied statement is the regression, not only a rendered SQL/string assertion.
      expect(
        await capturePostgresFailure(() =>
          f.runtime.unsafe("CREATE TABLE forbidden_runtime_table(id SERIAL PRIMARY KEY)"),
        ),
      ).toBe("42501");
      expect((await postgresIdentity(f.runtime)).schema_create).toBe(false);
    } finally {
      await server?.stop(true);
      registerDefaultDatabasePool(oldPool);
      if (oldBound) bindDatabaseConnection(oldBound);
      else resetBoundDatabaseConnection();
      restoreEnvVar("TENANCY_DRIVER", oldTenancy);
    }
  });
}, 30000);

test("effective schema CREATE follows PUBLIC, grants, memberships and ownership independently", async () => {
  await withPostgresProvisioningFixture(async (f) => {
    const fresh = await postgresIdentity(f.runtime);
    const modern = Number(fresh.version) >= 150000;
    expect(fresh.schema_create).toBe(!modern);
    const administrator = await postgresIdentity(f.admin);
    expect(fresh.schema_owner).toBe(modern ? "pg_database_owner" : administrator.current_user);
    evidence("fresh-cluster-defaults", { identity: fresh, acl: await postgresSchemaAcl(f.admin) });
    await f.admin.unsafe("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    expect((await postgresIdentity(f.runtime)).schema_create).toBe(false);
    await f.admin.unsafe(`GRANT CREATE ON SCHEMA public TO ${f.runtimeRole}`);
    expect((await postgresIdentity(f.runtime)).schema_create).toBe(true);
    // Grant convergence must not silently revoke an administrator's existing ACL policy.
    await grantPostgresAppRolePrivileges(f.admin, {
      database: f.databases[0],
      role: f.runtimeRole,
    });
    expect((await postgresIdentity(f.runtime)).schema_create).toBe(true);
    await f.admin.unsafe(`REVOKE CREATE ON SCHEMA public FROM ${f.runtimeRole}`);
    expect((await postgresIdentity(f.runtime)).schema_create).toBe(false);

    const group = f.runtimeRole.replace("app", "group");
    f.ownRole(group);
    await f.admin.unsafe(
      `CREATE ROLE ${group} NOLOGIN; GRANT CREATE ON SCHEMA public TO ${group}; GRANT ${group} TO ${f.runtimeRole}`,
    );
    expect((await postgresIdentity(f.runtime)).schema_create).toBe(false);
    if (Number(fresh.version) >= 160000) {
      await f.admin.unsafe(`GRANT ${group} TO ${f.runtimeRole} WITH INHERIT TRUE`);
    } else {
      await f.admin.unsafe(`ALTER ROLE ${f.runtimeRole} INHERIT`);
    }
    // A live session sees role-level INHERIT changes immediately; old versions may cache it at login.
    const inheriting = f.connection(f.runtimeRole);
    expect((await postgresIdentity(inheriting)).schema_create).toBe(true);
    evidence("inherited-schema-create", {
      identity: await postgresIdentity(inheriting),
      memberships: await f.admin.unsafe(
        "SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member, admin_option FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)",
        [f.runtimeRole],
      ),
    });
    if (Number(fresh.version) >= 160000) {
      await f.admin.unsafe(`GRANT ${group} TO ${f.runtimeRole} WITH INHERIT FALSE`);
    } else {
      await f.admin.unsafe(`ALTER ROLE ${f.runtimeRole} NOINHERIT`);
    }
    const noInheritance = f.connection(f.runtimeRole);
    expect((await postgresIdentity(noInheritance)).schema_create).toBe(false);
    await noInheritance.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${group}`);
      const switched = await postgresIdentity(tx);
      expect(switched.session_user).toBe(f.runtimeRole);
      expect(switched.current_user).toBe(group);
      expect(switched.schema_create).toBe(true);
      await tx.unsafe("CREATE TABLE membership_ddl(id INTEGER)");
      evidence("set-role-identity", switched);
    });
    await f.admin.unsafe(`REVOKE ${group} FROM ${f.runtimeRole}`);
    await f.admin.unsafe(`ALTER DATABASE ${f.databases[0]} OWNER TO ${f.runtimeRole}`);
    expect((await postgresIdentity(f.connection(f.runtimeRole))).schema_create).toBe(modern);
    await f.admin.unsafe(`ALTER SCHEMA public OWNER TO ${f.runtimeRole}`);
    expect((await postgresIdentity(f.connection(f.runtimeRole))).schema_create).toBe(true);
    evidence("schema-owner-create", await postgresIdentity(f.runtime));
  });
}, 30000);

test("a database-local advisory lock cannot serialize shared role changes across databases", async () => {
  await withPostgresProvisioningFixture(async (f) => {
    const other = f.connection((await postgresIdentity(f.admin)).current_user, f.databases[1]);
    await f.admin.begin(async (tx) => {
      await tx.unsafe("SELECT pg_advisory_xact_lock(184302, 27519)");
      // Same key, different database: succeeds while the first transaction still holds its lock.
      expect(
        (await other.unsafe("SELECT pg_try_advisory_xact_lock(184302,27519) AS acquired"))[0]
          .acquired,
      ).toBe(true);
    });
  });
}, 30000);
