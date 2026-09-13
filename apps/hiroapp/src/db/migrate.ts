import { hashPassword } from "@getstrata/core/auth/password";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import {
  grantPostgresAppRolePrivileges,
  openPostgresAdminConnection,
  postgresDatabaseNameFromUrl,
} from "@getstrata/core/tenant/enableTenantRls";
import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { Note } from "../models/Note.ts";
import { User } from "../models/User.ts";

const migrations = [
  `CREATE TABLE IF NOT EXISTS tenant (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL DEFAULT 'free',
    region TEXT NOT NULL DEFAULT 'eu'
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    body TEXT NOT NULL,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    mfa_secret TEXT,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_recovery_codes TEXT,
    session_valid_after TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS auth_one_time_tokens (
    id SERIAL PRIMARY KEY,
    purpose TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address TEXT,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `CREATE TABLE IF NOT EXISTS auth_saml_assertions (
    assertion_id TEXT PRIMARY KEY,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    abilities TEXT NOT NULL DEFAULT '[]',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE OR REPLACE FUNCTION app_bypass_rls()
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


ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notes;
CREATE POLICY tenant_isolation ON notes
USING (
  app_bypass_rls()
  OR tenant_id = app_current_tenant_id()
)
WITH CHECK (
  app_bypass_rls()
  OR tenant_id = app_current_tenant_id()
);


ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
USING (
  app_bypass_rls()
  OR tenant_id = app_current_tenant_id()
  OR (
    app_bypass_identifier() IS NOT NULL
    AND (
      id::text = app_bypass_identifier()
      OR email = app_bypass_identifier()
    )
  )
)
WITH CHECK (
  app_bypass_rls()
  OR tenant_id = app_current_tenant_id()
  OR (
    app_bypass_identifier() IS NOT NULL
    AND (
      id::text = app_bypass_identifier()
      OR email = app_bypass_identifier()
    )
  )
);


ALTER TABLE auth_one_time_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_one_time_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON auth_one_time_tokens;
CREATE POLICY tenant_isolation ON auth_one_time_tokens
USING (
  app_bypass_rls()
  OR EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth_one_time_tokens.user_id
      AND u.tenant_id = app_current_tenant_id()
  )
  OR (app_bypass_identifier() IS NOT NULL AND (auth_one_time_tokens.token_hash = app_bypass_identifier() OR auth_one_time_tokens.user_id::text = app_bypass_identifier()))
)
WITH CHECK (
  app_bypass_rls()
  OR EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth_one_time_tokens.user_id
      AND u.tenant_id = app_current_tenant_id()
  )
  OR (app_bypass_identifier() IS NOT NULL AND (auth_one_time_tokens.token_hash = app_bypass_identifier() OR auth_one_time_tokens.user_id::text = app_bypass_identifier()))
);


ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sessions;
CREATE POLICY tenant_isolation ON sessions
USING (
  app_bypass_rls()
  OR EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = sessions.user_id
      AND u.tenant_id = app_current_tenant_id()
  )
  OR (app_bypass_identifier() IS NOT NULL AND (sessions.id::text = app_bypass_identifier() OR sessions.user_id::text = app_bypass_identifier()))
)
WITH CHECK (
  app_bypass_rls()
  OR EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = sessions.user_id
      AND u.tenant_id = app_current_tenant_id()
  )
  OR (app_bypass_identifier() IS NOT NULL AND (sessions.id::text = app_bypass_identifier() OR sessions.user_id::text = app_bypass_identifier()))
);


ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_tokens;
CREATE POLICY tenant_isolation ON api_tokens
USING (
  app_bypass_rls()
  OR EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = api_tokens.user_id
      AND u.tenant_id = app_current_tenant_id()
  )
  OR (app_bypass_identifier() IS NOT NULL AND (api_tokens.token_hash = app_bypass_identifier() OR api_tokens.user_id::text = app_bypass_identifier()))
)
WITH CHECK (
  app_bypass_rls()
  OR EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = api_tokens.user_id
      AND u.tenant_id = app_current_tenant_id()
  )
  OR (app_bypass_identifier() IS NOT NULL AND (api_tokens.token_hash = app_bypass_identifier() OR api_tokens.user_id::text = app_bypass_identifier()))
);`,
];

export async function seed() {
  await ensureAppDatabase();
  const sql = getSql();
  await runWithMigrationBypass(async () => {
    const [{ count: tenantCount }] = await sql.unsafe<{ count: string | number }>(
      "SELECT COUNT(*) AS count FROM tenant",
    );
    if (Number(tenantCount) === 0) {
      await sql.unsafe("INSERT INTO tenant (slug, plan, region) VALUES ($1, $2, $3)", [
        "default",
        "free",
        "eu",
      ]);
    }
    if ((await Note.query().value("id")) === null) {
      await Note.create({ body: "Welcome to Strata!", tenant_id: 1 });
    }
    if ((await User.query().value("id")) === null) {
      const password = await hashPassword("StrataDemo!ChangeMe");
      await User.create({
        name: "Demo User",
        email: "demo@example.com",
        password,
        is_admin: false,
        email_verified_at: new Date().toISOString(),
      });
      await User.create({
        name: "Admin User",
        email: "admin@example.test",
        password,
        is_admin: true,
        email_verified_at: new Date().toISOString(),
      });
    }
  });
}

export async function migrate() {
  await ensureAppDatabase();
  const runtimeUrl = process.env.DATABASE_URL ?? "";
  const admin = await openPostgresAdminConnection({
    runtimeUrl,
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    for (const statement of migrations) {
      await admin.unsafe(statement);
    }
    await grantPostgresAppRolePrivileges(admin, {
      database: postgresDatabaseNameFromUrl(runtimeUrl),
    });
  } finally {
    await admin.close?.();
  }
  await seed();
}

/** The CLI calls this after migrate() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await migrate();
  console.log("Database migrated and seeded.");
  await close();
  process.exit(0);
}
