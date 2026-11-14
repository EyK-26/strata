import { defaultDatabaseUrl, defaultMigrationDatabaseUrl } from "./databaseDefaults.ts";
import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderConfigTs(plan: StarterFeaturePlan, projectName: string): string {
  const { layers, decisions } = plan;
  const defaults = {
    DATABASE_URL: defaultDatabaseUrl(layers, projectName),
    ...(defaultMigrationDatabaseUrl(layers, projectName)
      ? { MIGRATION_DATABASE_URL: defaultMigrationDatabaseUrl(layers, projectName) }
      : {}),
    FRONTEND_MODE: layers.frontend,
    SPA_PREFIX: layers.spaPrefix,
    CACHE_DRIVER: layers.cache,
    QUEUE_DRIVER: layers.queue,
    ...(decisions.redisQueue ? { QUEUE_REDIS_TRANSPORT: "streams" } : {}),
    MAIL_DRIVER: layers.mail,
    TENANCY_DRIVER: layers.tenancy,
  };
  return `/** Application choices; secrets and deployment values belong in the environment. */
export default ${JSON.stringify({ frontend: layers.frontend, tenancy: layers.tenancy, views: decisions.serverViews || decisions.mfaViews, scim: layers.extras.scim, metrics: layers.extras.metrics, defaults }, null, 2)} as const;
`;
}

function renderCreateAppTs(plan: StarterFeaturePlan): string {
  return `import { defineApp, type BootstrappedApp, type BootstrapOptions } from "@getstrata/bootstrap/application";
import { resolve } from "node:path";
import config from "../config/app.ts";
import paths from "../../strata.config.ts";
import { databaseOptions } from "./database.ts";
import { createStarterAuthServices, STARTER_AUTH_SERVICES } from "./auth.ts";
import { modelDefinitions, repositoryDefinitions } from "../models/register.ts";
import { Note } from "../models/Note.ts";
import { migrate } from "../db/migrate.ts";
import { listeners } from "../outbox/registry.ts";
${plan.decisions.ensureDatabase ? 'import { ensureAppDatabase } from "./ensureDatabase.ts";\n' : ""}${plan.decisions.workTracker ? 'import { WORK_TRACKER_OUTBOX } from "../domain/workTracker.ts";\n' : ""}
const { bootstrapApp, createApp, createAppServer } = defineApp({
  ...config,
  root: resolve(import.meta.dir, "../.."),
  modulesDirectory: paths.modulesDirectory,
  database: databaseOptions,
  auth: { create: createStarterAuthServices, token: STARTER_AUTH_SERVICES },
  models: modelDefinitions,
  repositories: repositoryDefinitions,
  migrate,${plan.decisions.ensureDatabase ? "\n  ensureDatabase: ensureAppDatabase," : ""}
  outbox: { listeners${plan.decisions.workTracker ? ", token: WORK_TRACKER_OUTBOX" : ""} },
  health: async database => { await database.model(Note).query().limit(1).select("id").get(); return true; },
});
export { bootstrapApp, createApp, createAppServer };
export type { BootstrappedApp, BootstrapOptions };
`;
}

function renderServerTs(): string {
  return `import { serveApplication } from "@getstrata/bootstrap/application";
import { createAppServer } from "./createApp.ts";
await serveApplication(createAppServer);
`;
}

function renderStrataConfigTs(): string {
  return `export default {
  application: "./src/bootstrap/createApp.ts",
  server: "./src/bootstrap/server.ts",
  schedule: "./src/bootstrap/schedule.ts",
  modulesDirectory: "./src/modules",
  commands: "./src/cli/register.ts",
  migrate: "./src/db/migrate.ts",
  fresh: "./src/db/fresh.ts",
};
`;
}

function renderOutboxRegistryTs(plan: StarterFeaturePlan): string {
  const workTracker = plan.decisions.workTracker;
  return `import type { DurableListener } from "@getstrata/core/events/outbox";
${workTracker ? 'import { workTrackerListener } from "../domain/workTracker.ts";\n' : ""}
/** Add listeners before publishing. An empty registry can run, and publish rejects unknown events. */
const listeners: readonly DurableListener[] = [${workTracker ? "workTrackerListener" : ""}];

export { listeners };
`;
}

function renderScheduleTs(): string {
  return `import { createAppSchedule } from "@getstrata/bootstrap/schedule";
import type { BootstrappedApp } from "./createApp.ts";
export function createSchedule(app:Pick<BootstrappedApp,"invoke"|"auditExport">,environment:Readonly<Record<string,string|undefined>>) {
  return createAppSchedule({invoke:app.invoke,auditExport:app.auditExport,environment});
}
`;
}

export {
  renderConfigTs,
  renderCreateAppTs,
  renderOutboxRegistryTs,
  renderScheduleTs,
  renderServerTs,
  renderStrataConfigTs,
};
