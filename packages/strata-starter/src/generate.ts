import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { copyOverlayTree, copyTree, removeIfExists, writeText } from "./copy.ts";
import type { ParsedFlags } from "./parseArgs.ts";
import { parseCreateStrataArgs, usage } from "./parseArgs.ts";
import { resolveStarterPlan } from "./prompt.ts";
import {
  renderAuthDirectory,
  renderAuthModule,
  renderAuthProvider,
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
  renderDockerCompose,
  renderEnvExample,
  renderGitignore,
  renderLayersManifest,
  renderPackageJson,
  renderReadme,
} from "./renderEnv.ts";
import {
  renderConfigProvider,
  renderConfigTs,
  renderCreateAppTs,
  renderDatabaseTs,
  renderEnsureDatabaseTs,
  renderFreshTs,
  renderMigrateTs,
  renderPreloadTs,
  renderProvidersIndex,
  renderQueueProvider,
  renderRollbackTs,
  renderRoutesTs,
  renderSeedTs,
  renderSidecarsTs,
  renderStatusTs,
  renderViewTs,
} from "./renderRuntime.ts";
import { renderScimModule } from "./renderScim.ts";
import type { GenerateOptions, StarterLayers } from "./types.ts";
import { htmlAuthKit, neededDockerServices, selectedDockerServices } from "./types.ts";

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

function applyFrontendOverlays(
  overlayRoot: string,
  targetDir: string,
  layers: StarterLayers,
): void {
  if (layers.frontend === "hybrid" || layers.frontend === "spa-react") {
    copyOverlayTree(join(overlayRoot, "spa-react"), targetDir);
  }
  if (layers.frontend === "api") {
    copyOverlayTree(join(overlayRoot, "api"), targetDir);
  }
}

function writeGeneratedFiles(options: GenerateOptions): void {
  const { targetDir, projectName, layers } = options;
  const src = join(targetDir, "src");

  writeText(join(targetDir, ".env.example"), renderEnvExample(projectName, layers));
  writeText(join(targetDir, ".gitignore"), renderGitignore());
  writeText(
    join(targetDir, "package.json"),
    renderPackageJson(projectName, { ...options, layers }),
  );
  writeText(join(targetDir, "README.md"), renderReadme(projectName, layers));
  writeText(join(targetDir, "strata.layers.json"), renderLayersManifest(projectName, layers));

  const compose = renderDockerCompose(projectName, layers);
  if (compose) {
    writeText(join(targetDir, "docker-compose.yml"), compose);
  } else {
    removeIfExists(join(targetDir, "docker-compose.yml"));
  }

  writeText(join(src, "routes.ts"), renderRoutesTs());
  writeText(join(src, "lib/view.ts"), renderViewTs(layers));
  writeText(join(src, "bootstrap/config.ts"), renderConfigTs());
  writeText(join(src, "bootstrap/preload.ts"), renderPreloadTs(layers, projectName));
  writeText(join(src, "bootstrap/database.ts"), renderDatabaseTs(layers));
  const ensureDatabase = renderEnsureDatabaseTs(layers, projectName);
  if (ensureDatabase) {
    writeText(join(src, "bootstrap/ensureDatabase.ts"), ensureDatabase);
  } else {
    removeIfExists(join(src, "bootstrap/ensureDatabase.ts"));
  }
  writeText(join(src, "bootstrap/createApp.ts"), renderCreateAppTs(layers));
  writeText(join(src, "bootstrap/providers/config.ts"), renderConfigProvider(layers));
  writeText(join(src, "bootstrap/providers/queue.ts"), renderQueueProvider());
  writeText(join(src, "bootstrap/providers/index.ts"), renderProvidersIndex());
  writeText(join(src, "bootstrap/providers/auth.ts"), renderAuthProvider(layers));
  writeText(join(src, "db/migrate.ts"), renderMigrateTs(layers));
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

  if (layers.extras.mfa && htmlAuthKit(layers.auth)) {
    writeText(join(src, "bootstrap/pendingMfa.ts"), renderPendingMfaTs());
  } else {
    removeIfExists(join(src, "bootstrap/pendingMfa.ts"));
  }

  writeText(join(targetDir, "public/assets/site.css"), renderSiteCss());
  writeText(join(targetDir, "views/home.eta"), renderHomeView(projectName, layers));
  writeText(join(targetDir, "views/layouts/app.eta"), renderLayout(layers, projectName));
  if (htmlAuthKit(layers.auth)) {
    writeText(join(targetDir, "views/auth/login.eta"), renderLoginView());
    writeText(join(targetDir, "views/auth/register.eta"), renderRegisterView());
    writeText(join(targetDir, "views/auth/forgot-password.eta"), renderForgotPasswordView());
    writeText(join(targetDir, "views/auth/reset-password.eta"), renderResetPasswordView());
    if (layers.extras.emailVerification) {
      writeText(join(targetDir, "views/auth/verify-email.eta"), renderVerifyEmailView());
    }
    if (layers.extras.mfa) {
      writeText(join(targetDir, "views/auth/mfa-challenge.eta"), renderMfaChallengeView());
      writeText(join(targetDir, "views/auth/mfa-setup.eta"), renderMfaSetupView());
    }
  }

  mkdirSync(join(targetDir, "storage"), { recursive: true });
  writeText(join(targetDir, "storage/.gitkeep"), "");
}

function printNextSteps(projectName: string, layers: StarterLayers, compose: boolean): void {
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
  console.log(`  cd ${projectName}`);
  console.log("  cp .env.example .env");
  if (compose) {
    console.log("  docker compose up -d");
  }
  if (dockerOn.includes("adminer")) {
    console.log("  Adminer: http://localhost:8080");
  }
  if (localOn.length > 0) {
    console.log(`  Point env at local ${localOn.join(", ")} (see README).`);
  }
  console.log("  bun install");
  console.log("  strata migrate");
  console.log("  strata dev\n");
}

function generateProject(options: GenerateOptions): void {
  assertProjectName(options.projectName);
  if (existsSync(options.targetDir)) {
    if (!options.force) {
      throw new Error(`Directory already exists: ${options.targetDir}`);
    }
    rmSync(options.targetDir, { recursive: true, force: true });
  }

  copyTree(options.templateRoot, options.targetDir, options.projectName, new Set(["overlays"]));
  applyFrontendOverlays(options.overlayRoot, options.targetDir, options.layers);
  writeGeneratedFiles(options);
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
    const targetDir = resolve(cwd, plan.projectName);
    generateProject({
      projectName: plan.projectName,
      targetDir,
      layers: plan.layers,
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
      force: flags.force,
    });
    printNextSteps(
      plan.projectName,
      plan.layers,
      renderDockerCompose(plan.projectName, plan.layers) !== null,
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
  resolveTemplateRoot,
  runCreateStrata,
  starterPackageRoot,
};
