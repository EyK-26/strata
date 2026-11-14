import { defaultDatabaseUrl } from "./databaseDefaults.ts";
import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderDatabaseTs(plan: StarterFeaturePlan, projectName = "strata"): string {
  return `import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { resolveDatabaseOptions } from "@getstrata/bootstrap/databaseCommands";

/** Copy configuration once at composition; opening and closing belong to the Application. */
export function databaseOptions(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return resolveDatabaseOptions(environment, { driver: "${plan.decisions.sqlDriver}", defaultUrl: ${JSON.stringify(defaultDatabaseUrl(plan.layers, projectName))} });
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
  return `import { ensureDatabase, resolveDatabaseOptions } from "@getstrata/bootstrap/databaseCommands";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";

export async function ensureAppDatabase(options: { provision?: boolean } = {}): Promise<string> {
  const environment = Object.freeze({ ...process.env });
  const connection = resolveDatabaseOptions(environment, { driver: "${plan.decisions.sqlDriver}", defaultUrl: ${JSON.stringify(defaultDatabaseUrl(plan.layers, projectName))} });
  if (connection.driver === "sqlite") throw new Error("Unexpected provisioning database driver");
  return ensureDatabase({ driver: connection.driver, runtimeUrl: connection.url, migrationUrl: environment.MIGRATION_DATABASE_URL,
    password: environment.STRATA_APP_PASSWORD, production: isProductionEnv(environment), provision: options.provision });
}
`;
}

function renderSidecarsTs(_plan: StarterFeaturePlan): string | null {
  return null;
}

export { renderDatabaseTs, renderEnsureDatabaseTs, renderSidecarsTs };
