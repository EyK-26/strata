function assertSafeIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return identifier;
}

const RLS_HELPER_SQL = `
CREATE OR REPLACE FUNCTION app_bypass_rls()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.bypass_rls', true), 'false') = 'true';
EXCEPTION
  WHEN others THEN
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION app_bypass_identifier()
RETURNS TEXT AS $$
BEGIN
  RETURN NULLIF(current_setting('app.bypass_identifier', true), '');
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS INTEGER AS $$
BEGIN
  RETURN NULLIF(current_setting('app.tenant_id', true), '')::INTEGER;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
`;

function tenantIsolationPolicy(table: string, predicate: string): string {
  return `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ${table};
CREATE POLICY tenant_isolation ON ${table}
USING (
  app_bypass_rls()
  OR ${predicate}
)
WITH CHECK (
  app_bypass_rls()
  OR ${predicate}
);
`;
}

function enableTenantRlsSql(tableName: string): string {
  const table = assertSafeIdentifier(tableName);
  return tenantIsolationPolicy(table, `tenant_id = app_current_tenant_id()`);
}

function enableUsersRlsSql(): string {
  return tenantIsolationPolicy(
    "users",
    `tenant_id = app_current_tenant_id()
  OR (
    app_bypass_identifier() IS NOT NULL
    AND (
      id::text = app_bypass_identifier()
      OR email = app_bypass_identifier()
    )
  )`,
  );
}

function userOwnedIdentifierPredicate(table: string, userIdColumn: string): string {
  const userIdMatch = `${table}.${userIdColumn}::text = app_bypass_identifier()`;
  if (table === "sessions") {
    return `(app_bypass_identifier() IS NOT NULL AND (${table}.id::text = app_bypass_identifier() OR ${userIdMatch}))`;
  }
  if (table === "api_tokens" || table === "auth_one_time_tokens") {
    return `(app_bypass_identifier() IS NOT NULL AND (${table}.token_hash = app_bypass_identifier() OR ${userIdMatch}))`;
  }
  return `(app_bypass_identifier() IS NOT NULL AND ${userIdMatch})`;
}

function enableUserOwnedRlsSql(tableName: string, userIdColumn = "user_id"): string {
  const table = assertSafeIdentifier(tableName);
  const column = assertSafeIdentifier(userIdColumn);
  return tenantIsolationPolicy(
    table,
    `EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = ${table}.${column}
      AND u.tenant_id = app_current_tenant_id()
  )
  OR ${userOwnedIdentifierPredicate(table, column)}`,
  );
}

function generatedRlsBootstrapSql(
  tables: readonly string[],
  userOwnedTables: readonly string[] = [],
): string {
  return [
    RLS_HELPER_SQL,
    ...tables.map((table) => (table === "users" ? enableUsersRlsSql() : enableTenantRlsSql(table))),
    ...userOwnedTables.map((table) => enableUserOwnedRlsSql(table)),
  ].join("\n");
}

export {
  assertPostgresRoleCannotBypassRls,
  dropPostgresTablesAsAdmin,
  ensurePostgresAppRole,
  ensurePostgresDatabaseAndAppRole,
  grantPostgresAppRolePrivileges,
  inspectCurrentPostgresRole,
  isPostgresUrl,
  openPostgresAdminConnection,
  POSTGRES_APP_ROLE,
  POSTGRES_APP_ROLE_PASSWORD,
  POSTGRES_SUPERUSER_PASSWORD,
  postgresAppRoleSql,
  postgresDatabaseNameFromUrl,
  postgresUrlUsername,
} from "./postgresAppRole";
export { enableTenantRlsSql, enableUserOwnedRlsSql, generatedRlsBootstrapSql, RLS_HELPER_SQL };
