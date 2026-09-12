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

function enableTenantRlsSql(tableName: string): string {
  const table = assertSafeIdentifier(tableName);
  return `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ${table};
CREATE POLICY tenant_isolation ON ${table}
USING (
  app_bypass_rls()
  OR tenant_id = app_current_tenant_id()
)
WITH CHECK (
  app_bypass_rls()
  OR tenant_id = app_current_tenant_id()
);
`;
}

function generatedRlsBootstrapSql(tables: readonly string[]): string {
  return [RLS_HELPER_SQL, ...tables.map((table) => enableTenantRlsSql(table))].join("\n");
}

export { enableTenantRlsSql, generatedRlsBootstrapSql, RLS_HELPER_SQL };
