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

The owner must be authorized to grant/revoke the requested database/schema/object privileges. This grant-only helper does not create/alter roles, rotate passwords or lock `pg_authid`. Its default privileges apply to objects subsequently created **by that same migration identity**; another object creator needs its own default ACLs. Include all generated application migrations, including tenancy/RLS migrations. If administrators manage runtime ACLs independently, they can apply their chosen policy instead of calling the convenience grant helper.

On published 2.2.54, the grant-only helper still adds schema `CREATE`. While using that version, retain an administrator-managed ACL policy or explicitly remove `CREATE` after grants; calling the old helper again restores its old grant. The migration runner itself does not grant schema privileges to runtime roles.

The generated PostgreSQL `migrate`/`migrate:fresh` convenience commands explicitly request provisioning before running migrations. Setting `MIGRATION_DATABASE_URL` to a restricted owner does not turn off that step. For externally provisioned deployments, retain an explicit schema-only command like the above rather than editing installed packages or adding a second provisioning API. Generated rollback avoids role creation/rotation but retains post-operation runtime privilege repair and requires the appropriate object-owner rights. Explicit migrate, fresh and rollback remain administrative operations even when they have no pending migration changes.

### Read-only migration status

`bun run src/db/status.ts` inspects existing migration history without provisioning, DDL, ownership changes or runtime privilege repair. Its PostgreSQL connection needs database CONNECT, schema USAGE and SELECT on `framework_migrations`; it does not need schema CREATE, role administration or the authority to grant runtime privileges. The public `getMigrationStatus()` likewise reads existing history. Missing history or insufficient SELECT access produces the database error without creating a replacement table or treating lost history as an empty migration set. An existing empty history table still reports pending migrations. Initialize a new database through an explicit migration command first; investigate unexpectedly missing history instead of recreating it through status.

Earlier generated PostgreSQL status files call the same helper as mutations and can reapply the stock table/default grants, widening an operator's narrower ACLs. Existing apps must deliberately adopt both changes: upgrade the core status implementation, add the generated helper's optional `{ grantRuntimePrivileges?: boolean }` argument (defaulting to repair for existing mutation callers), and pass `{ grantRuntimePrivileges: false }` from `src/db/status.ts`. Package upgrades do not rewrite those application files. This flag controls the helper's post-operation privilege repair; it does not make an arbitrary callback read-only. Keep normal migrate/fresh/rollback repair unless the operator deliberately owns a different grant policy.

The installed regression compares direct/default ACLs, ownership, role attributes, RLS policies and migration history before/after status under an owner and a restricted history reader. It also verifies honest missing/denied-history errors, explicit migration/rollback repair, forced RLS and sequence-backed runtime writes. The separate app's explicit schema-only migration command remains supported and is not replaced by this correction. Managed-provider behavior and adoption of an existing app's generated files still require separate verification.

Boot an explicitly migrated generated app with `bootstrapApp({ migrate: false })`; this also disables automatic local provisioning. Production/staging runtime startup already resolves and validates the pre-existing runtime connection without provisioning. A custom migration requiring an extension, role, database or other privileged object still needs an administrator for that operation: the public runner cannot create privileges its connection lacks.

## Runtime schema CREATE

The corrected shared grant renderer grants `USAGE` on `public`, without adding `CREATE`. The 2.2.54 renderer (also present before this correction in current source) explicitly granted both. Ordinary HTTP/ORM reads, updates/deletes and sequence-backed inserts, failed-job persistence and SQL outbox delivery do not need schema `CREATE`; their tables, sequences and RLS policies are installed by migrations. Runtime migrations or application-defined DDL do require a separate authorized identity.

The earlier schema correction only stopped adding the direct schema grant. It did not revoke existing schema grants, change ownership, remove role memberships or modify PUBLIC, and left table/sequence/function grants unchanged. Published 2.2.57 therefore still grants table `ALL`, including `TRUNCATE`, which PostgreSQL does not subject to RLS. The runtime-object correction below addresses that separate defect; it does not automatically remove an older schema `CREATE` grant.

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

## Runtime table and sequence privileges (#364)

The corrected shared renderer reserves table maintenance for the migration/administrator identity. It revokes the runtime role's existing direct table and sequence grants, then grants table `SELECT, INSERT, UPDATE, DELETE` and sequence `USAGE, SELECT`. It likewise replaces the executing migration identity's per-schema default grants for future tables/sequences. Full provisioning, the grant-only helper and generated init/repeatable SQL share this policy. Schema `USAGE` and function `EXECUTE` remain unchanged.

This repairs the broad direct/default grants emitted by 2.2.57 and earlier; merely adding CRUD grants would leave existing `TRUNCATE` rights intact. It also removes `REFERENCES`, `TRIGGER`, PostgreSQL 17+ `MAINTAIN` and sequence `UPDATE` (`setval`). Ordinary ORM reads/writes, sequence-backed inserts and failed-job persistence work without those privileges. Custom runtime DDL, maintenance or sequence-reset operations must move to an explicitly authorized administrative command. Do not give the HTTP server or worker migration credentials to restore those capabilities.

Real PostgreSQL 16/17 regressions cover fresh provisioning, repair of legacy current/default ACLs, and a restricted non-superuser database owner's grant-only path. Two-tenant FORCE RLS reads/writes and sequence-backed ORM inserts pass; runtime `TRUNCATE` of existing and subsequently migrated tables fails with `42501`; migration maintenance still succeeds. A late failed grant batch rolls back both current and default ACL changes. Existing database advisory and cross-database role-catalog locks are unchanged. This confirms an overbroad runtime privilege defect, not an unauthenticated HTTP exploit or a general sandbox for arbitrary SQL: application tenant-context selection and executable functions remain trusted boundaries.

### Adopt the object-grant correction deliberately

1. Upgrade to a release containing the #364 correction. Package installation alone does not update live ACLs or rewrite application-owned SQL files. Replace older `db/ensure-postgres-app-role.sql` and `docker/postgres-init/01-strata-app-role.sql` with the corrected generated policy, retaining your reviewed database/role/credential configuration. Old SQL or old helper versions can restore the unsafe `ALL` grants. Docker init SQL only runs automatically for an empty volume.
2. As the authorized migration/object owner, run the corrected grant-only helper shown above after migrations, or apply the reviewed corrected SQL explicitly. Generated CLI migration commands also reapply grants, but still require full role-provisioning privileges. Externally provisioned deployments should retain their explicit schema-only migration command and invoke the grant-only helper if they want this policy; the catalog-administration constraint has not changed.
3. Apply future-object policy for **each actual object creator**. Per-schema defaults add to global defaults: revoking a per-schema grant cannot cancel a global default grant. Review global/default ACLs separately before tightening them. This helper intentionally does not rewrite another creator's defaults, PUBLIC, memberships, ownership or shared policies. Dependent onward grants may cause revocation to fail; there is no silent skip or `CASCADE` removal.
4. Verify effective privileges using a fresh runtime login, then run real application/worker CRUD and sequence inserts. Check both existing tables and a table created later by the actual migration identity. Verify tenant isolation, denied maintenance, and migration/admin operations separately.

For example, inspect the effective runtime rights (the `MAINTAIN` privilege name is only available on PostgreSQL 17+):

```sql
SELECT current_user, session_user,
       has_table_privilege(current_user, 'notes', 'SELECT') AS can_select,
       has_table_privilege(current_user, 'notes', 'INSERT') AS can_insert,
       has_table_privilege(current_user, 'notes', 'UPDATE') AS can_update,
       has_table_privilege(current_user, 'notes', 'DELETE') AS can_delete,
       has_table_privilege(current_user, 'notes', 'TRUNCATE') AS can_truncate,
       has_table_privilege(current_user, 'notes', 'REFERENCES') AS can_reference,
       has_table_privilege(current_user, 'notes', 'TRIGGER') AS can_trigger,
       has_sequence_privilege(current_user, 'notes_id_seq', 'USAGE') AS sequence_usage,
       has_sequence_privilege(current_user, 'notes_id_seq', 'UPDATE') AS can_reset_sequence;
SELECT defaclrole::regrole AS creator, defaclnamespace::regnamespace AS schema,
       defaclobjtype, defaclacl
FROM pg_default_acl;
```

A surviving maintenance right may come from PUBLIC, inherited/assumable roles, ownership or global defaults rather than the helper's direct grant. Use the membership/ownership inspection above and inspect table ACLs (`pg_class.relacl`) and schema ACLs as well. A runtime owner, superuser or BYPASSRLS identity is not repaired into a non-owning role merely by changing object grants.

The installed generated-app acceptance exercises fresh grants, CLI repair without a pending migration, and the emitted init/repeatable SQL against installed candidate packages. It boots without runtime administrator credentials, uses generated models for tenant CRUD and verifies failed-job persistence. Managed-provider behavior, including Neon, remains unverified. Existing apps' explicit migration adaptation remains necessary where cluster provisioning is unavailable.

For rollback, separate application rollback from ACL rollback. Installing an older release does not restore revoked privileges, but rerunning its old provisioning helper/SQL will reintroduce broad grants. Keep the corrected ACL policy in administrative tooling when rolling back application code. If a custom maintenance operation fails, grant only its reviewed requirement to a separate maintenance identity; do not blindly restore runtime `ALL`.

PostgreSQL references: [table locks](https://www.postgresql.org/docs/17/sql-lock.html), [PostgreSQL 15 public schema changes](https://www.postgresql.org/docs/15/release-15.html), [role membership](https://www.postgresql.org/docs/17/role-membership.html), [RLS scope](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [table/sequence privileges](https://www.postgresql.org/docs/17/sql-grant.html), [default ACL scope](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).
