# PostgreSQL provisioning and migration identities

Database/role provisioning and application schema migrations have different privilege requirements. HTTP servers and workers should connect as a separate, non-owning runtime role with `NOSUPERUSER NOBYPASSRLS`. Keep migration credentials out of those processes. For RLS tenancy, retain the generated policies, `FORCE ROW LEVEL SECURITY` and transaction-local tenant context; removing a schema grant does not replace those controls.

## Role provisioning requires catalog administration

`ensurePostgresAppRole` creates or alters a cluster-wide login role, including its password and role attributes, then grants access in the application database. `ensurePostgresDatabaseAndAppRole` also creates the database when needed. These administrative helpers are not schema-only migration runners.

Role creation/rotation takes `LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE`. The catalog is shared by all databases in the PostgreSQL cluster. The lock serializes cooperating first creation and existing-role changes across databases, remaining held through commit or rollback; connection loss releases it. A database-local advisory lock cannot provide that guarantee. The separate database advisory lock serializes cooperating privilege/default-ACL batches in one application database; it does not replace the role-catalog lock.

`CREATEROLE` alone does **not** authorize the catalog lock. A non-superuser can successfully create an ordinary role and still receive SQLSTATE `42501` from full Strata provisioning. Use a suitably authorized cluster administrator for that operation. Do not grant catalog write privileges to runtime or migration roles merely to satisfy this helper. Managed services may restrict catalog administration even for their administrative accounts; qualify that provider separately. This constraint was reproduced on disposable PostgreSQL 14 and 17, not on Neon.

## Externally provisioned databases and roles

An administrator or the provider may create the database and roles separately. Give the migration identity ownership of the application schema/objects (or the specific DDL rights its migrations need). A database owner with `NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS` can then run the existing public migration API without provisioning roles:

```typescript
import { SQL } from "bun";
import { join } from "node:path";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import {
  loadMigrationsFromDirectory,
  migrateDatabase,
} from "@getstrata/core/database/migrations";
import {
  grantPostgresAppRolePrivileges,
  postgresDatabaseNameFromUrl,
} from "@getstrata/core/tenant/enableTenantRls";

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!ownerUrl || !runtimeUrl) throw new Error("Explicit migration and runtime URLs required");
// Both URLs must target the same, already provisioned application database.
if (postgresDatabaseNameFromUrl(ownerUrl) !== postgresDatabaseNameFromUrl(runtimeUrl))
  throw new Error("Migration and runtime databases must match");
const owner = new SQL({ url: ownerUrl, max: 1 });
try {
  const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "migrations"));
  await runWithSqlDialect("pgsql", () => migrateDatabase(owner, migrations, { advisoryLock: true }));
  await grantPostgresAppRolePrivileges(owner, {
    database: postgresDatabaseNameFromUrl(runtimeUrl),
    role: decodeURIComponent(new URL(runtimeUrl).username),
  });
} finally {
  await owner.close();
}
```

The owner must be authorized to grant the requested database/schema/object privileges. This grant-only helper does not create/alter roles, rotate passwords or lock `pg_authid`. Its default privileges apply to objects subsequently created **by that same migration identity**; another object creator needs its own default ACLs. Include all generated application migrations, including tenancy/RLS migrations. If administrators manage runtime ACLs independently, they can apply their chosen policy instead of calling the broad convenience grant helper.

On published 2.2.54, the grant-only helper still adds schema `CREATE`. While using that version, retain an administrator-managed ACL policy or explicitly remove `CREATE` after grants; calling the old helper again restores its old grant. The migration runner itself does not grant schema privileges to runtime roles.

The generated PostgreSQL `migrate`/`migrate:fresh` convenience commands explicitly request provisioning before running migrations. Setting `MIGRATION_DATABASE_URL` to a restricted owner does not turn off that step. For externally provisioned deployments, retain an explicit schema-only command like the above rather than editing installed packages or adding a second provisioning API. Generated status/rollback avoid role creation/rotation, but their migration wrapper still performs post-operation grants and requires the appropriate object-owner rights.

Boot an explicitly migrated generated app with `bootstrapApp({ migrate: false })`; this also disables automatic local provisioning. Production/staging runtime startup already resolves and validates the pre-existing runtime connection without provisioning. A custom migration requiring an extension, role, database or other privileged object still needs an administrator for that operation: the public runner cannot create privileges its connection lacks.

## Runtime schema CREATE

The corrected shared grant renderer grants `USAGE` on `public`, without adding `CREATE`. The 2.2.54 renderer (also present before this correction in current source) explicitly granted both. Ordinary HTTP/ORM reads, updates/deletes and sequence-backed inserts, failed-job persistence and SQL outbox delivery do not need schema `CREATE`; their tables, sequences and RLS policies are installed by migrations. Runtime migrations or application-defined DDL do require a separate authorized identity.

This change only stops adding the direct schema grant. It deliberately does not revoke existing grants, change schema ownership, remove role memberships or modify PUBLIC. It leaves the existing table/sequence/function grant policy unchanged. In particular, `ALL` on tables includes privileges beyond ordinary CRUD (such as `TRUNCATE`, which PostgreSQL does not subject to RLS). This helper is not a complete least-privilege ACL policy; deployments requiring CRUD-only database permissions must apply explicit object/default ACLs separately. The tested tenant guarantees concern normal scoped reads/writes, not unrestricted arbitrary SQL under every granted table privilege.

Fresh PostgreSQL 14 clusters normally grant schema `CREATE` to PUBLIC; fresh PostgreSQL 15+ databases normally do not and use `pg_database_owner` as the `public` schema owner. Upgrades/restores may retain the old ACL/ownership. `NOINHERIT` is not proof that a login cannot gain schema privileges: explicit membership inheritance options on newer PostgreSQL, `SET ROLE`, schema ownership, or database ownership through `pg_database_owner` can supply them.

### Existing applications and adoption

Installing a corrected package or rerunning grants does not revoke an older `CREATE` grant. Generated init SQL is an application file and only runs automatically for an empty database volume; package installation does not rewrite it or alter an existing volume. Adopt the corrected generated SQL for future provisioning, and review existing databases explicitly before tightening permissions.

Inspect the live **runtime connection**, not just the configured username:

```sql
SELECT session_user, current_user, current_database(),
       has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit
FROM pg_roles WHERE rolname = current_user;
SELECT pg_get_userbyid(datdba) AS database_owner
FROM pg_database WHERE datname = current_database();
SELECT pg_get_userbyid(nspowner) AS schema_owner, nspacl
FROM pg_namespace WHERE nspname = 'public';
SELECT pg_get_userbyid(roleid) AS parent_role, pg_get_userbyid(member) AS member,
       admin_option
FROM pg_auth_members;
```

Inspect inherited memberships recursively and, on PostgreSQL 16+, `inherit_option` and `set_option`. Schema ACL entries for PUBLIC, owners and parent roles matter as well as the runtime role's direct entry. Migration and runtime identities must be different if runtime DDL is to be denied.

After confirming no runtime feature/custom extension performs DDL, an authorized administrator/schema owner can remove an old direct grant:

```sql
REVOKE CREATE ON SCHEMA public FROM strata_app;
```

Where PUBLIC still has `CREATE`, separately assess the other users of that schema before revoking it from PUBLIC. If runtime owns the database/schema, first plan ownership transfer to the migration identity, including any runtime-owned objects; revocation alone does not establish a durable non-owning boundary. Address inherited/assumable roles explicitly. Do not automatically strip shared grants or memberships from a library helper.

Recheck effective privileges on a fresh runtime login. Verify that runtime `CREATE TABLE` fails with `42501`, migration DDL succeeds under the owner, sequence-backed inserts/read/update/delete and applicable queue/outbox operations still work, and cross-tenant reads/writes remain denied. Existing apps using a schema-only migration command still need that adaptation when cluster provisioning is unavailable; the schema-grant correction does not change the catalog-administration requirement.

For rollback, restore only the specific grant or membership actually removed, under administrator control. Reinstalling an older package does not undo a revocation. Restoring runtime schema `CREATE` deliberately restores its ability to create objects and should not be necessary for the framework operations above.

PostgreSQL references: [table locks](https://www.postgresql.org/docs/17/sql-lock.html), [PostgreSQL 15 public schema changes](https://www.postgresql.org/docs/15/release-15.html), [role membership](https://www.postgresql.org/docs/17/role-membership.html), [RLS scope](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
