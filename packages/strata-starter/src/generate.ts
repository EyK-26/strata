import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { copyOverlayTree, copyTree, removeIfExists, writeText } from "./copy.ts";
import { usesComposePostgres } from "./databaseDefaults.ts";
import { compileStarterFeatures, type StarterFeaturePlan } from "./featurePlan.ts";
import type { ParsedFlags } from "./parseArgs.ts";
import { parseCreateStrataArgs, usage } from "./parseArgs.ts";
import { resolveStarterPlan } from "./prompt.ts";
import {
  renderAuthDirectory,
  renderAuthModule,
  renderAuthProvider,
  renderConfirmPasswordView,
  renderForgotPasswordView,
  renderHomeView,
  renderLayout,
  renderLoginView,
  renderMfaChallengeView,
  renderMfaSetupView,
  renderPendingMfaTs,
  renderRegisterView,
  renderResetPasswordView,
  renderSiteCss,
  renderSiteModule,
  renderVerifyEmailView,
} from "./renderAuth.ts";
import {
  renderConfigProvider,
  renderConfigTs,
  renderCreateAppTs,
  renderOutboxRegistryTs,
  renderPolicyProvider,
  renderPreloadTs,
  renderProvidersIndex,
  renderQueueProvider,
  renderRoutesTs,
  renderScheduleTs,
  renderViewProvider,
} from "./renderBootstrap.ts";
import {
  renderCliOpenApiTs,
  renderCliOutboxWorkTs,
  renderCliQueueFailedTs,
  renderCliQueueWorkTs,
  renderCliRegisterTs,
  renderCliScheduleRunTs,
} from "./renderCli.ts";
import { renderDatabaseTs, renderEnsureDatabaseTs, renderSidecarsTs } from "./renderDatabase.ts";
import { renderDockerCompose, renderDockerfile, renderDockerignore } from "./renderDocker.ts";
import {
  renderApiDocs,
  renderEnvExample,
  renderGitignore,
  renderLayersManifest,
  renderPackageJson,
  renderPostgresAppRoleInitSql,
  renderReadme,
} from "./renderEnv.ts";
import { renderInitialAdminCommand, renderInitialAdminMigration } from "./renderInitialAdmin.ts";
import {
  billingMigrationName,
  renderApplyStripeWebhook,
  renderBillingMigration,
  renderBillingModule,
  renderDispatchOutboundWebhookJob,
  renderNoteCreatedWebhookListener,
  renderWebhooksMigration,
  webhookMigrationName,
} from "./renderIntegrations.ts";
import {
  renderAccountStateMigration,
  renderFreshTs,
  renderMigrateTs,
  renderMigrationRuntimeTs,
  renderOutboxMigration,
  renderRollbackTs,
  renderSeedTs,
  renderStarterSchemaMigration,
  renderStatusTs,
} from "./renderMigrations.ts";
import {
  renderApiTokenModel,
  renderAuthOneTimeTokenModel,
  renderModelsRegister,
  renderNoteModel,
  renderUserModel,
} from "./renderModels.ts";
import { renderScimModule } from "./renderScim.ts";
import {
  renderWorkTrackerDomain,
  renderWorkTrackerMigration,
  renderWorkTrackerModels,
  renderWorkTrackerModule,
} from "./renderWorkTracker.ts";
import type { GenerateOptions, StarterLayers } from "./types.ts";
import {
  dockerComposeUpCommand,
  neededDockerServices,
  needsFrontendBuild,
  selectedDockerServices,
} from "./types.ts";

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;

function starterPackageRoot(): string {
  return join(import.meta.dir, "..");
}

function resolveTemplateRoot(root = starterPackageRoot()): string {
  const fromDist = join(root, "templates");
  if (existsSync(join(fromDist, "src"))) {
    return fromDist;
  }
  const nested = join(root, "dist/templates");
  if (existsSync(join(nested, "src"))) {
    return nested;
  }
  return fromDist;
}

function resolveOverlayRoot(root = starterPackageRoot()): string {
  const candidates = [
    join(root, "templates/overlays"),
    join(root, "dist/templates/overlays"),
    join(root, "../../templates/scaffold"),
  ];
  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "server-htmx")) ||
      existsSync(join(candidate, "spa-react")) ||
      existsSync(join(candidate, "api"))
    ) {
      return candidate;
    }
  }
  return candidates[0] ?? join(root, "templates/overlays");
}

function assertProjectName(projectName: string): void {
  if (!PROJECT_NAME_PATTERN.test(projectName)) {
    throw new Error("Project name must contain only letters, numbers, hyphens, and underscores.");
  }
}

/**
 * `my-app`, `./my-app`, and `/tmp/my-app` are all accepted. The last path
 * segment becomes the project name; the rest selects where to write.
 */
function resolveProjectTarget(
  rawTarget: string,
  cwd: string,
): { projectName: string; targetDir: string } {
  const targetDir = resolve(cwd, rawTarget.trim());
  const projectName = basename(targetDir);
  assertProjectName(projectName);
  return { projectName, targetDir };
}

function applyFrontendOverlays(
  overlayRoot: string,
  targetDir: string,
  layers: StarterLayers,
): void {
  if (layers.frontend === "hybrid" || layers.frontend === "spa-react") {
    copyOverlayTree(join(overlayRoot, "spa-react"), targetDir);
  }
}

function writeGeneratedFiles(options: GenerateOptions, plan: StarterFeaturePlan): void {
  const { decisions } = plan;
  const { targetDir, projectName, layers } = options;
  const src = join(targetDir, "src");
  if (decisions.frontendBuild) {
    const transport = decisions.browserTransport;
    const mfa = transport === "cookie" && layers.extras.mfa;
    writeText(
      join(targetDir, "frontend/src/auth/config.ts"),
      `export type AuthTransport = "cookie" | "token" | "jwt" | "headers";\nexport const AUTH_CONFIG: { transport: AuthTransport; mfa: boolean } = ${JSON.stringify({ transport, mfa })};\n`,
    );

    writeText(
      join(targetDir, "frontend/src/config.ts"),
      `import { validateSpaPrefix } from "@getstrata/core/runtime/frontendMode";

// Generated scripts supply only this public value before Bun starts.
export const SPA_PREFIX = validateSpaPrefix(process.env.BUN_PUBLIC_SPA_PREFIX);
export const TENANCY_ENABLED = ${decisions.tenantTable};
`,
    );
    const manifestPath = join(targetDir, "frontend/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    // Bun's HTML/HMR bundler reads its scoped environment at process startup.
    const publicEnv = `BUN_PUBLIC_SPA_PREFIX="\${SPA_PREFIX:-${layers.spaPrefix}}"`;
    manifest.scripts.dev = `${publicEnv} bun --hot dev-server.ts`;
    manifest.scripts.build = `${publicEnv} bun run build.ts`;
    manifest.scripts.preview = `bun run build && ${publicEnv} bun dev-server.ts --preview`;
    writeText(manifestPath, JSON.stringify(manifest, null, 2));
  }

  writeText(join(targetDir, ".bun-version"), "1.4.4\n");
  writeText(join(targetDir, ".env.example"), renderEnvExample(projectName, layers));
  writeText(join(targetDir, ".gitignore"), renderGitignore());
  writeText(
    join(targetDir, "package.json"),
    renderPackageJson(projectName, { ...options, layers }),
  );
  writeText(
    join(targetDir, "README.md"),
    renderReadme(projectName, layers, {
      inRepoExample: options.inRepoExample,
      dogfood: options.dogfood,
    }),
  );
  if (layers.frontend === "api") {
    writeText(join(targetDir, "docs/API.md"), renderApiDocs(projectName, layers));
  } else {
    removeIfExists(join(targetDir, "docs/API.md"));
  }
  writeText(join(targetDir, "strata.layers.json"), renderLayersManifest(projectName, layers));

  writeText(join(targetDir, "Dockerfile"), renderDockerfile(layers));
  writeText(join(targetDir, ".dockerignore"), renderDockerignore(layers));

  const compose = renderDockerCompose(projectName, layers);
  if (compose) {
    writeText(join(targetDir, "docker-compose.yml"), compose);
  } else {
    removeIfExists(join(targetDir, "docker-compose.yml"));
  }
  const postgresInit = renderPostgresAppRoleInitSql(projectName, layers);
  if (postgresInit) {
    writeText(join(targetDir, "db/ensure-postgres-app-role.sql"), postgresInit);
    if (usesComposePostgres(layers)) {
      writeText(join(targetDir, "docker/postgres-init/01-strata-app-role.sql"), postgresInit);
    } else {
      removeIfExists(join(targetDir, "docker/postgres-init"));
    }
  } else {
    removeIfExists(join(targetDir, "db/ensure-postgres-app-role.sql"));
    removeIfExists(join(targetDir, "docker/postgres-init"));
  }

  writeText(join(src, "routes.ts"), renderRoutesTs());
  writeText(join(src, "bootstrap/providers/view.ts"), renderViewProvider(layers));
  writeText(join(src, "bootstrap/config.ts"), renderConfigTs());
  writeText(join(src, "bootstrap/preload.ts"), renderPreloadTs(layers, projectName));
  writeText(join(src, "bootstrap/database.ts"), renderDatabaseTs(layers));
  const ensureDatabase = renderEnsureDatabaseTs(layers, projectName);
  if (ensureDatabase) {
    writeText(join(src, "bootstrap/ensureDatabase.ts"), ensureDatabase);
  } else {
    removeIfExists(join(src, "bootstrap/ensureDatabase.ts"));
  }
  writeText(
    join(src, "bootstrap/createApp.ts"),
    renderCreateAppTs(layers, plan.reference === "work-tracker"),
  );
  writeText(join(src, "bootstrap/schedule.ts"), renderScheduleTs());
  writeText(join(src, "cli/register.ts"), renderCliRegisterTs(layers));
  const initialAdminCommand = renderInitialAdminCommand(layers);
  const initialAdminMigration = renderInitialAdminMigration(layers);
  if (initialAdminCommand && initialAdminMigration) {
    writeText(join(src, "cli/initialAdmin.ts"), initialAdminCommand);
    writeText(join(src, "db/migrations/0004_initial_admin_provisioning.ts"), initialAdminMigration);
  } else {
    removeIfExists(join(src, "cli/initialAdmin.ts"));
    removeIfExists(join(src, "db/migrations/0004_initial_admin_provisioning.ts"));
  }
  writeText(join(src, "cli/queueWork.ts"), renderCliQueueWorkTs());
  writeText(join(src, "cli/outboxWork.ts"), renderCliOutboxWorkTs());
  writeText(
    join(src, "outbox/registry.ts"),
    renderOutboxRegistryTs(plan.reference === "work-tracker"),
  );
  writeText(join(src, "cli/queueFailed.ts"), renderCliQueueFailedTs());
  writeText(join(src, "cli/openapi.ts"), renderCliOpenApiTs());
  writeText(join(src, "cli/scheduleRun.ts"), renderCliScheduleRunTs());
  writeText(join(src, "bootstrap/providers/config.ts"), renderConfigProvider(layers));
  writeText(join(src, "bootstrap/providers/queue.ts"), renderQueueProvider());
  writeText(join(src, "bootstrap/providers/policy.ts"), renderPolicyProvider());
  writeText(join(src, "bootstrap/providers/index.ts"), renderProvidersIndex());
  writeText(join(src, "bootstrap/providers/auth.ts"), renderAuthProvider(layers));
  writeText(join(src, "models/Note.ts"), renderNoteModel(layers));
  if (decisions.users) {
    writeText(join(src, "models/User.ts"), renderUserModel(layers));
    writeText(join(src, "models/AuthOneTimeToken.ts"), renderAuthOneTimeTokenModel());
  } else {
    removeIfExists(join(src, "models/User.ts"));
    removeIfExists(join(src, "models/AuthOneTimeToken.ts"));
  }
  if (decisions.token) {
    writeText(join(src, "models/ApiToken.ts"), renderApiTokenModel());
  } else {
    removeIfExists(join(src, "models/ApiToken.ts"));
  }
  writeText(
    join(src, "models/register.ts"),
    renderModelsRegister(layers, plan.reference === "work-tracker"),
  );
  writeText(join(src, "db/migrate.ts"), renderMigrateTs(layers));
  writeText(join(src, "db/migrationRuntime.ts"), renderMigrationRuntimeTs(layers));
  writeText(
    join(src, "db/migrations/0001_starter_schema.ts"),
    renderStarterSchemaMigration(layers),
  );
  writeText(join(src, "db/migrations/0005_outbox.ts"), renderOutboxMigration(layers));
  if (decisions.users) {
    writeText(
      join(src, "db/migrations/0006_account_state.ts"),
      renderAccountStateMigration(layers),
    );
  } else {
    removeIfExists(join(src, "db/migrations/0006_account_state.ts"));
  }
  removeIfExists(join(src, "db/migrations/0002_webhooks_schema.ts"));
  removeIfExists(join(src, "db/migrations/0002_billing_schema.ts"));
  removeIfExists(join(src, "db/migrations/0003_billing_schema.ts"));
  const webhooksMigration = renderWebhooksMigration(layers);
  const webhooksName = webhookMigrationName(layers);
  if (webhooksMigration && webhooksName) {
    writeText(join(src, `db/migrations/${webhooksName}.ts`), webhooksMigration);
  }
  const billingMigration = renderBillingMigration(layers);
  const billingName = billingMigrationName(layers);
  if (billingMigration && billingName) {
    writeText(join(src, `db/migrations/${billingName}.ts`), billingMigration);
  }
  writeText(join(src, "db/fresh.ts"), renderFreshTs(layers));
  writeText(join(src, "db/seed.ts"), renderSeedTs());
  writeText(join(src, "db/status.ts"), renderStatusTs(layers));
  writeText(join(src, "db/rollback.ts"), renderRollbackTs(layers));
  writeText(join(src, "modules/site/index.ts"), renderSiteModule(layers));

  const directory = renderAuthDirectory(layers);
  if (directory) {
    writeText(join(src, "bootstrap/authDirectory.ts"), directory);
  }

  const sidecars = renderSidecarsTs(layers);
  if (sidecars) {
    writeText(join(src, "bootstrap/sidecars.ts"), sidecars);
  }

  const authModule = renderAuthModule(layers);
  if (authModule) {
    writeText(join(src, "modules/auth/index.ts"), authModule);
  }

  const scimModule = renderScimModule(layers);
  if (scimModule) {
    writeText(join(src, "modules/scim/index.ts"), scimModule);
  } else {
    removeIfExists(join(src, "modules/scim/index.ts"));
  }

  if (layers.extras.billing) {
    writeText(join(src, "billing/applyStripeWebhook.ts"), renderApplyStripeWebhook());
    writeText(join(src, "modules/billing/index.ts"), renderBillingModule(layers));
  } else {
    removeIfExists(join(src, "billing/applyStripeWebhook.ts"));
    removeIfExists(join(src, "modules/billing/index.ts"));
  }

  if (layers.extras.webhooks) {
    writeText(
      join(src, "jobs/dispatchOutboundWebhookJob.ts"),
      renderDispatchOutboundWebhookJob(layers),
    );
    writeText(
      join(src, "listeners/noteCreatedWebhookListener.ts"),
      renderNoteCreatedWebhookListener(),
    );
  } else {
    removeIfExists(join(src, "jobs/dispatchOutboundWebhookJob.ts"));
    removeIfExists(join(src, "listeners/noteCreatedWebhookListener.ts"));
  }

  if (decisions.pendingMfa) {
    writeText(join(src, "bootstrap/pendingMfa.ts"), renderPendingMfaTs());
  } else {
    removeIfExists(join(src, "bootstrap/pendingMfa.ts"));
  }

  writeText(join(targetDir, "public/assets/site.css"), renderSiteCss());
  // HTMX 2.0.4 from unpkg. See templates/public/assets/htmx.min.js.version.
  const htmxSource = join(
    options.templateRoot ?? starterPackageRoot(),
    "public/assets/htmx.min.js",
  );
  const htmxFallback = join(starterPackageRoot(), "templates/public/assets/htmx.min.js");
  const htmxPath = existsSync(htmxSource) ? htmxSource : htmxFallback;
  if (existsSync(htmxPath)) {
    mkdirSync(join(targetDir, "public/assets"), { recursive: true });
    copyFileSync(htmxPath, join(targetDir, "public/assets/htmx.min.js"));
    const versionSidecar = `${htmxPath}.version`;
    if (existsSync(versionSidecar)) {
      copyFileSync(versionSidecar, join(targetDir, "public/assets/htmx.min.js.version"));
    }
  }
  writeText(join(targetDir, "views/home.eta"), renderHomeView(projectName, layers));
  writeText(join(targetDir, "views/layouts/app.eta"), renderLayout(layers, projectName));
  if (decisions.htmlAuth) {
    writeText(join(targetDir, "views/auth/login.eta"), renderLoginView(layers));
    writeText(join(targetDir, "views/auth/register.eta"), renderRegisterView());
    writeText(join(targetDir, "views/auth/forgot-password.eta"), renderForgotPasswordView());
    writeText(join(targetDir, "views/auth/reset-password.eta"), renderResetPasswordView());
    if (layers.extras.emailVerification) {
      writeText(join(targetDir, "views/auth/verify-email.eta"), renderVerifyEmailView());
    }
    if (layers.extras.mfa) {
      writeText(join(targetDir, "views/auth/mfa-challenge.eta"), renderMfaChallengeView());
      writeText(join(targetDir, "views/auth/mfa-setup.eta"), renderMfaSetupView());
      writeText(join(targetDir, "views/auth/confirm-password.eta"), renderConfirmPasswordView());
    }
  }

  if (plan.reference === "work-tracker") {
    writeText(join(src, "domain/workTracker.ts"), renderWorkTrackerDomain());
    writeText(join(src, "models/workTracker.ts"), renderWorkTrackerModels());
    writeText(join(src, "modules/workTracker/index.ts"), renderWorkTrackerModule());
    writeText(join(src, "db/migrations/0007_work_tracker.ts"), renderWorkTrackerMigration(layers));
  }

  mkdirSync(join(targetDir, "storage"), { recursive: true });
  writeText(join(targetDir, "storage/.gitkeep"), "");
}

function printNextSteps(
  projectName: string,
  layers: StarterLayers,
  compose: boolean,
  cdTarget = projectName,
): void {
  const dockerOn = selectedDockerServices(layers);
  const neededTools = neededDockerServices(layers);
  const localOn = neededTools.filter((name) => !dockerOn.includes(name));
  const dockerSummary =
    dockerOn.length > 0 ? dockerOn.join("+") : neededTools.length === 0 ? "none" : "local";
  console.log(`\nCreated Strata app in ${projectName}/\n`);
  console.log(
    `frontend=${layers.frontend}  db=${layers.database}  auth=${layers.auth}  docker=${dockerSummary}`,
  );
  console.log("\nNext steps:");
  console.log(`  cd ${cdTarget}`);
  console.log("  cp .env.example .env");
  if (compose) {
    console.log(`  ${dockerComposeUpCommand(layers)}`);
  }
  if (dockerOn.includes("adminer")) {
    console.log("  Adminer: http://localhost:8080");
  }
  if (localOn.length > 0) {
    console.log(`  Point env at local ${localOn.join(", ")} (see README).`);
  }
  console.log("  bun install");
  if (needsFrontendBuild(layers.frontend)) {
    console.log("  bun run frontend:install");
    console.log("  bun run frontend:build");
  }
  console.log("  bun run db:migrate");
  console.log("  bun run dev\n");
  console.log("The strata binary is local to the app, so use the bun run scripts above.");
  console.log("Run it directly with bunx strata <command> from inside the app directory.\n");
}

function generateProject(options: GenerateOptions): void {
  assertProjectName(options.projectName);
  const plan = compileStarterFeatures(options.layers, options.reference);
  mkdirSync(dirname(options.targetDir), { recursive: true });
  // mkdir is the ownership boundary: it refuses files, directories and dangling symlinks.
  // --force never authorizes deleting an existing application's data.
  try {
    mkdirSync(options.targetDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Output path already exists: ${options.targetDir}. Choose a new path; --force does not overwrite existing projects.`,
      );
    }
    throw error;
  }
  const owned = lstatSync(options.targetDir);
  try {
    copyTree(options.templateRoot, options.targetDir, options.projectName, new Set(["overlays"]));
    applyFrontendOverlays(options.overlayRoot, options.targetDir, plan.layers);
    writeGeneratedFiles({ ...options, layers: plan.layers }, plan);
    for (const artifact of plan.artifacts) {
      if (!lstatSync(join(options.targetDir, artifact)).isFile()) {
        throw new Error(`Feature plan artifact was not rendered: ${artifact}`);
      }
    }
    const inventory = (directory: string, prefix = ""): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? inventory(join(directory, entry.name), path) : [path];
      });
    writeText(
      join(options.targetDir, "strata.features.json"),
      JSON.stringify(
        {
          ...plan,
          emittedArtifacts: [
            ...new Set([...inventory(options.targetDir), "strata.features.json"]),
          ].sort(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    // Never remove a path replaced by another owner while rendering.
    try {
      const current = lstatSync(options.targetDir);
      if (current.dev === owned.dev && current.ino === owned.ino) {
        rmSync(options.targetDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AggregateError(
          [error, cleanupError],
          "Starter generation and owned-output cleanup failed.",
        );
      }
    }
    throw error;
  }
}

async function runCreateStrata(argv: string[], cwd = process.cwd()): Promise<number> {
  let flags: ParsedFlags;
  try {
    flags = parseCreateStrataArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  if (flags.help) {
    console.log(usage());
    return 0;
  }

  try {
    const plan = await resolveStarterPlan(flags);
    const { projectName, targetDir } = resolveProjectTarget(plan.projectName, cwd);
    generateProject({
      projectName,
      targetDir,
      layers: plan.layers,
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
      force: flags.force,
    });
    printNextSteps(
      projectName,
      plan.layers,
      renderDockerCompose(projectName, plan.layers) !== null,
      plan.projectName,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

export {
  generateProject,
  printNextSteps,
  resolveOverlayRoot,
  resolveProjectTarget,
  resolveTemplateRoot,
  runCreateStrata,
  starterPackageRoot,
};
