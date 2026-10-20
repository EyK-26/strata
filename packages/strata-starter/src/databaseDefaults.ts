import { type StarterLayers, selectedDockerServices } from "./types.ts";

const GENERATED_POSTGRES_APP_ROLE = "strata_app";
const GENERATED_POSTGRES_APP_PASSWORD = "dev-strata-app-change-me";
const GENERATED_POSTGRES_SUPERUSER_PASSWORD = "dev-postgres-change-me";
const GENERATED_MYSQL_ROOT_PASSWORD = "dev-mysql-change-me";

function appDatabaseName(projectName: string): string {
  return projectName.replace(/[^A-Za-z0-9_]/g, "_");
}

function usesComposePostgres(layers: StarterLayers): boolean {
  return selectedDockerServices(layers).includes("postgres");
}

function defaultDatabaseUrl(layers: StarterLayers, projectName: string): string {
  if (layers.database === "sqlite") {
    return "sqlite:./storage/app.sqlite";
  }
  const database = appDatabaseName(projectName);
  if (layers.database === "mysql") {
    return `mysql://root:${GENERATED_MYSQL_ROOT_PASSWORD}@localhost:3306/${database}`;
  }
  return `postgresql://${GENERATED_POSTGRES_APP_ROLE}:${GENERATED_POSTGRES_APP_PASSWORD}@localhost:5432/${database}`;
}

function defaultMigrationDatabaseUrl(layers: StarterLayers, projectName: string): string | null {
  if (layers.database !== "postgres") {
    return null;
  }
  const database = appDatabaseName(projectName);
  return `postgresql://postgres:${GENERATED_POSTGRES_SUPERUSER_PASSWORD}@localhost:5432/${database}`;
}

export {
  appDatabaseName,
  defaultDatabaseUrl,
  defaultMigrationDatabaseUrl,
  GENERATED_MYSQL_ROOT_PASSWORD,
  GENERATED_POSTGRES_APP_PASSWORD,
  GENERATED_POSTGRES_APP_ROLE,
  GENERATED_POSTGRES_SUPERUSER_PASSWORD,
  usesComposePostgres,
};
