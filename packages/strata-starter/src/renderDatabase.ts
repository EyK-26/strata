import { defaultDatabaseUrl, defaultMigrationDatabaseUrl } from "./databaseDefaults.ts";
import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderDatabaseTs(plan: StarterFeaturePlan, projectName = "strata"): string {
  return `import { resolve } from "node:path";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { resolveDatabaseOptions } from "@getstrata/bootstrap/databaseCommands";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";

export function databaseEnvironment(input: Readonly<Record<string, string | undefined>> = process.env) {
  const environment = { ...input };
  if (!isProductionEnv(environment) && !environment.APP_DATABASE_URL?.trim() && !environment.DATABASE_URL?.trim()) {
    environment.DATABASE_URL = ${JSON.stringify(defaultDatabaseUrl(plan.layers, projectName))};
${defaultMigrationDatabaseUrl(plan.layers, projectName) ? `    environment.MIGRATION_DATABASE_URL ??= ${JSON.stringify(defaultMigrationDatabaseUrl(plan.layers, projectName))};` : ""}
  }
  return Object.freeze(environment);
}

/** Copy configuration once at composition; opening and closing belong to the Application. */
export function databaseOptions(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return resolveDatabaseOptions(databaseEnvironment(environment), { driver: "${plan.decisions.sqlDriver}", defaultUrl: ${JSON.stringify(defaultDatabaseUrl(plan.layers, projectName))}, root: resolve(import.meta.dir, "../..") });
}

export async function pingDatabase(selected: DatabaseSession | TransactionSession): Promise<boolean> {
  try {
    await selected.execute({ text: "SELECT 1", params: [] });
    return true;
  } catch {
    return false;
  }
}
`;
}

function renderEnsureDatabaseTs(plan: StarterFeaturePlan, projectName: string): string | null {
  if (plan.layers.database === "sqlite") return null;
  return `import { resolve } from "node:path";
import { ensureDatabase, resolveDatabaseOptions } from "@getstrata/bootstrap/databaseCommands";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { databaseEnvironment } from "./database.ts";

export async function ensureAppDatabase(options: { provision?: boolean; environment?: Readonly<Record<string, string | undefined>> } = {}): Promise<string> {
  const environment = databaseEnvironment(options.environment ?? process.env);
  const connection = resolveDatabaseOptions(environment, { driver: "${plan.decisions.sqlDriver}", defaultUrl: ${JSON.stringify(defaultDatabaseUrl(plan.layers, projectName))}, root: resolve(import.meta.dir, "../..") });
  if (connection.driver === "sqlite") throw new Error("Unexpected provisioning database driver");
  return ensureDatabase({ driver: connection.driver, runtimeUrl: connection.url, migrationUrl: environment.MIGRATION_DATABASE_URL,
    password: environment.STRATA_APP_PASSWORD, production: isProductionEnv(environment), provision: options.provision });
}
`;
}

export { renderDatabaseTs, renderEnsureDatabaseTs };
