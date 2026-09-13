-- Application login role. FORCE RLS applies because this role is NOSUPERUSER and NOBYPASSRLS.
-- Superuser remains for CREATE ROLE / CREATE DATABASE / GRANT / migrate.
-- This script is repeatable on an already-existing volume (not only docker-entrypoint-initdb.d).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'strata_app') THEN
    CREATE ROLE strata_app LOGIN PASSWORD 'dev-strata-app-change-me'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE strata_app WITH LOGIN PASSWORD 'dev-strata-app-change-me'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE hiroapp TO strata_app;
GRANT USAGE, CREATE ON SCHEMA public TO strata_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO strata_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO strata_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO strata_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO strata_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO strata_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO strata_app;
