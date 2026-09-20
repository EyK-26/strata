import type { Migration } from "@getstrata/core/database/migrations/types";

const migration: Migration = {
  name: "0001_starter_schema",
  async up(db) {
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS failed_job (\n    id SERIAL PRIMARY KEY,\n    job_name TEXT NOT NULL,\n    payload JSONB NOT NULL,\n    exception TEXT NOT NULL,\n    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS tenant (\n    id SERIAL PRIMARY KEY,\n    slug TEXT NOT NULL UNIQUE,\n    plan TEXT NOT NULL DEFAULT 'free',\n    region TEXT NOT NULL DEFAULT 'eu'\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS notes (\n    id SERIAL PRIMARY KEY,\n    body TEXT NOT NULL,\n    tenant_id INTEGER NOT NULL DEFAULT 1,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS users (\n    id SERIAL PRIMARY KEY,\n    name TEXT NOT NULL,\n    email TEXT NOT NULL UNIQUE,\n    password TEXT NOT NULL,\n    is_admin BOOLEAN NOT NULL DEFAULT FALSE,\n    tenant_id INTEGER NOT NULL DEFAULT 1,\n    mfa_secret TEXT,\n    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,\n    mfa_recovery_codes TEXT,\n    session_valid_after TIMESTAMPTZ,\n    email_verified_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS auth_one_time_tokens (\n    id SERIAL PRIMARY KEY,\n    purpose TEXT NOT NULL,\n    user_id INTEGER NOT NULL,\n    token_hash TEXT NOT NULL UNIQUE,\n    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    consumed_at TIMESTAMPTZ\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS sessions (\n    id TEXT PRIMARY KEY,\n    user_id INTEGER NOT NULL,\n    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    user_agent TEXT,\n    ip_address TEXT,\n    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS auth_saml_assertions (\n    assertion_id TEXT PRIMARY KEY,\n    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE TABLE IF NOT EXISTS api_tokens (\n    id SERIAL PRIMARY KEY,\n    user_id INTEGER NOT NULL,\n    name TEXT NOT NULL,\n    token_hash TEXT NOT NULL UNIQUE,\n    abilities TEXT NOT NULL DEFAULT '[]',\n    expires_at TIMESTAMPTZ,\n    last_used_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n  )",
    );
    await db.unsafe(
      "CREATE OR REPLACE FUNCTION app_bypass_rls()\nRETURNS BOOLEAN AS $$\nBEGIN\n  RETURN COALESCE(current_setting('app.bypass_rls', true), 'false') = 'true';\nEXCEPTION\n  WHEN others THEN\n    RETURN FALSE;\nEND;\n$$ LANGUAGE plpgsql STABLE;\n\nCREATE OR REPLACE FUNCTION app_bypass_identifier()\nRETURNS TEXT AS $$\nBEGIN\n  RETURN NULLIF(current_setting('app.bypass_identifier', true), '');\nEXCEPTION\n  WHEN others THEN\n    RETURN NULL;\nEND;\n$$ LANGUAGE plpgsql STABLE;\n\nCREATE OR REPLACE FUNCTION app_current_tenant_id()\nRETURNS INTEGER AS $$\nBEGIN\n  RETURN NULLIF(current_setting('app.tenant_id', true), '')::INTEGER;\nEXCEPTION\n  WHEN others THEN\n    RETURN NULL;\nEND;\n$$ LANGUAGE plpgsql STABLE;\n\n\nALTER TABLE notes ENABLE ROW LEVEL SECURITY;\nALTER TABLE notes FORCE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS tenant_isolation ON notes;\nCREATE POLICY tenant_isolation ON notes\nUSING (\n  app_bypass_rls()\n  OR tenant_id = app_current_tenant_id()\n)\nWITH CHECK (\n  app_bypass_rls()\n  OR tenant_id = app_current_tenant_id()\n);\n\n\nALTER TABLE users ENABLE ROW LEVEL SECURITY;\nALTER TABLE users FORCE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS tenant_isolation ON users;\nCREATE POLICY tenant_isolation ON users\nUSING (\n  app_bypass_rls()\n  OR tenant_id = app_current_tenant_id()\n  OR (\n    app_bypass_identifier() IS NOT NULL\n    AND (\n      id::text = app_bypass_identifier()\n      OR email = app_bypass_identifier()\n    )\n  )\n)\nWITH CHECK (\n  app_bypass_rls()\n  OR tenant_id = app_current_tenant_id()\n  OR (\n    app_bypass_identifier() IS NOT NULL\n    AND (\n      id::text = app_bypass_identifier()\n      OR email = app_bypass_identifier()\n    )\n  )\n);\n\n\nALTER TABLE auth_one_time_tokens ENABLE ROW LEVEL SECURITY;\nALTER TABLE auth_one_time_tokens FORCE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS tenant_isolation ON auth_one_time_tokens;\nCREATE POLICY tenant_isolation ON auth_one_time_tokens\nUSING (\n  app_bypass_rls()\n  OR EXISTS (\n    SELECT 1 FROM users u\n    WHERE u.id = auth_one_time_tokens.user_id\n      AND u.tenant_id = app_current_tenant_id()\n  )\n  OR (app_bypass_identifier() IS NOT NULL AND (auth_one_time_tokens.token_hash = app_bypass_identifier() OR auth_one_time_tokens.user_id::text = app_bypass_identifier()))\n)\nWITH CHECK (\n  app_bypass_rls()\n  OR EXISTS (\n    SELECT 1 FROM users u\n    WHERE u.id = auth_one_time_tokens.user_id\n      AND u.tenant_id = app_current_tenant_id()\n  )\n  OR (app_bypass_identifier() IS NOT NULL AND (auth_one_time_tokens.token_hash = app_bypass_identifier() OR auth_one_time_tokens.user_id::text = app_bypass_identifier()))\n);\n\n\nALTER TABLE sessions ENABLE ROW LEVEL SECURITY;\nALTER TABLE sessions FORCE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS tenant_isolation ON sessions;\nCREATE POLICY tenant_isolation ON sessions\nUSING (\n  app_bypass_rls()\n  OR EXISTS (\n    SELECT 1 FROM users u\n    WHERE u.id = sessions.user_id\n      AND u.tenant_id = app_current_tenant_id()\n  )\n  OR (app_bypass_identifier() IS NOT NULL AND (sessions.id::text = app_bypass_identifier() OR sessions.user_id::text = app_bypass_identifier()))\n)\nWITH CHECK (\n  app_bypass_rls()\n  OR EXISTS (\n    SELECT 1 FROM users u\n    WHERE u.id = sessions.user_id\n      AND u.tenant_id = app_current_tenant_id()\n  )\n  OR (app_bypass_identifier() IS NOT NULL AND (sessions.id::text = app_bypass_identifier() OR sessions.user_id::text = app_bypass_identifier()))\n);\n\n\nALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;\nALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS tenant_isolation ON api_tokens;\nCREATE POLICY tenant_isolation ON api_tokens\nUSING (\n  app_bypass_rls()\n  OR EXISTS (\n    SELECT 1 FROM users u\n    WHERE u.id = api_tokens.user_id\n      AND u.tenant_id = app_current_tenant_id()\n  )\n  OR (app_bypass_identifier() IS NOT NULL AND (api_tokens.token_hash = app_bypass_identifier() OR api_tokens.user_id::text = app_bypass_identifier()))\n)\nWITH CHECK (\n  app_bypass_rls()\n  OR EXISTS (\n    SELECT 1 FROM users u\n    WHERE u.id = api_tokens.user_id\n      AND u.tenant_id = app_current_tenant_id()\n  )\n  OR (app_bypass_identifier() IS NOT NULL AND (api_tokens.token_hash = app_bypass_identifier() OR api_tokens.user_id::text = app_bypass_identifier()))\n);",
    );
  },
  async down(db) {
    await db.unsafe("DROP TABLE IF EXISTS failed_job CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS api_tokens CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS sessions CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS auth_saml_assertions CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS auth_one_time_tokens CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS users CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS notes CASCADE");
    await db.unsafe("DROP TABLE IF EXISTS tenant CASCADE");
  },
};

export default migration;
