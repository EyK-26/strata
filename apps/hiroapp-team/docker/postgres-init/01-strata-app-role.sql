-- Application login role. FORCE RLS applies because this role is NOSUPERUSER and NOBYPASSRLS.
-- Compose POSTGRES_USER is a superuser and skips FORCE RLS; do not use it as DATABASE_URL.
-- This file runs only on an empty Postgres volume.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'strata_app') THEN
    CREATE ROLE strata_app LOGIN PASSWORD 'dev-strata-app-change-me'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE hiroapp_team TO strata_app;
GRANT USAGE, CREATE ON SCHEMA public TO strata_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO strata_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO strata_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO strata_app;
