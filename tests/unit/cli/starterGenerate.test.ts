import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "@getstrata/bootstrap/contracts";
import { resetDiscoverModulesForTests } from "@getstrata/bootstrap/discoverModules";
import { resetBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { resetDefaultDatabasePoolForTests } from "@getstrata/core/database/defaultConnection";
import { resetSqlDialect } from "@getstrata/core/database/dialect";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { defaultLayers, exampleAppLayers } from "../../../packages/strata-starter/src/presets.ts";
import { type Prompter, promptLayers } from "../../../packages/strata-starter/src/prompt.ts";
import { jsonCsrfHeaders, mergeCookies } from "../../helpers/jsonCsrf";
import { appTest, installGeneratedAppDependencies, repoRoot } from "./helpers";

const tempDirectories: string[] = [];
const ENV_KEYS = [
  "APP_DATABASE_URL",
  "FEATURE_SCIM",
  "SCIM_BEARER_TOKEN",
  "SCIM_TENANT_TOKENS",
  "REDIS_URL",
  "DATABASE_URL",
  "APP_URL",
  "APP_ENV",
  "FRONTEND_MODE",
  "AUTH_DEV_HEADERS",
  "TENANCY_DRIVER",
  "SESSION_SECRET",
  "SPA_PREFIX",
  "CACHE_DRIVER",
  "QUEUE_DRIVER",
  "MAIL_DRIVER",
  "METRICS_TOKEN",
  "FEATURE_OAUTH",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreRuntime(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetSqlDialect();
  resetBoundDatabaseConnection();
  resetDefaultDatabasePoolForTests();
  resetDiscoverModulesForTests();
}

afterEach(async () => {
  process.chdir(repoRoot);
  restoreRuntime();
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "strata-starter-"));
  tempDirectories.push(directory);
  return directory;
}

function generateFromArgs(directory: string, argv: string[]): string {
  const flags = parseCreateStrataArgs(argv);
  const name = flags.projectName ?? "app";
  generateProject({
    projectName: name,
    targetDir: join(directory, name),
    layers: layersFromFlags(flags),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });
  return join(directory, name);
}

function scriptedPrompter(script: {
  select?: string[];
  confirm?: boolean[];
  question?: string[];
  multiSelect?: string[][];
  onMultiSelect?: (message: string, values: string[]) => void;
}): Prompter {
  const select = [...(script.select ?? [])];
  const confirm = [...(script.confirm ?? [])];
  const question = [...(script.question ?? [])];
  const multiSelect = [...(script.multiSelect ?? [])];
  return {
    async question(_message, defaultValue) {
      if (question.length === 0) {
        return defaultValue ?? "";
      }
      return question.shift() ?? defaultValue ?? "";
    },
    async confirm(message) {
      if (confirm.length === 0) {
        throw new Error(`unexpected confirm: ${message}`);
      }
      return confirm.shift() ?? false;
    },
    async select(message, choices, defaultValue) {
      if (select.length === 0) {
        throw new Error(`unexpected select: ${message}`);
      }
      const value = select.shift();
      if (!value || !choices.some((choice) => choice.value === value)) {
        throw new Error(`scripted select "${value}" is not in choices for: ${message}`);
      }
      return value as typeof defaultValue;
    },
    async multiSelect<T extends string>(
      _message: string,
      choices: Array<{ value: T; label: string; enabled: boolean }>,
    ): Promise<T[]> {
      script.onMultiSelect?.(
        _message,
        choices.map((choice) => choice.value),
      );
      if (multiSelect.length === 0) {
        throw new Error(`unexpected multiSelect: ${_message}`);
      }
      const values = multiSelect.shift() ?? [];
      for (const value of values) {
        if (!choices.some((choice) => choice.value === value)) {
          throw new Error(`scripted multiSelect "${value}" is not in choices for: ${_message}`);
        }
      }
      return values as T[];
    },
    close() {},
  };
}

describe("create-strata args", () => {
  test("defaults to sqlite JSON API without docker", () => {
    const flags = parseCreateStrataArgs(["acme", "--yes"]);
    expect(flags.projectName).toBe("acme");
    const layers = layersFromFlags(flags);
    expect(layers.frontend).toBe("api");
    expect(layers.database).toBe("sqlite");
    expect(layers.auth).toBe("headers");
    expect(layers.docker.enabled).toBe(false);
  });

  test("parses layer overrides and docker flags", () => {
    const flags = parseCreateStrataArgs([
      "acme",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie-token",
      "--cache=redis",
      "--queue=redis",
      "--docker",
      "--yes",
    ]);
    const layers = layersFromFlags(flags);
    expect(layers.frontend).toBe("server-htmx");
    expect(layers.database).toBe("sqlite");
    expect(layers.auth).toBe("cookie-token");
    expect(layers.cache).toBe("redis");
    expect(layers.docker.enabled).toBe(true);
    expect(layers.docker.services.postgres).toBe(false);
    expect(layers.docker.services.redis).toBe(true);
    expect(layers.docker.services.adminer).toBe(false);
  });

  test("parses docker flags and last-wins --no-docker", () => {
    const docker = parseCreateStrataArgs([
      "acme",
      "--database=postgres",
      "--cache=redis",
      "--queue=redis",
      "--docker",
      "--yes",
    ]);
    expect(docker.docker).toBe(true);
    expect(layersFromFlags(docker).docker.services.postgres).toBe(true);
    expect(layersFromFlags(docker).docker.services.redis).toBe(true);
    expect(layersFromFlags(docker).docker.services.adminer).toBe(false);

    const local = parseCreateStrataArgs([
      "acme",
      "--database=postgres",
      "--cache=redis",
      "--docker",
      "--no-docker",
      "--yes",
    ]);
    expect(local.docker).toBe(false);
    expect(layersFromFlags(local).docker.enabled).toBe(false);

    const subset = parseCreateStrataArgs([
      "acme",
      "--database=postgres",
      "--cache=redis",
      "--queue=redis",
      "--docker-services=postgres,redis",
      "--yes",
    ]);
    expect(subset.dockerServices).toEqual(["postgres", "redis"]);

    expect(() => parseCreateStrataArgs(["acme", "--docker-services=mongo"])).toThrow(
      /Unknown docker service/,
    );
  });

  test("unknown --kit is rejected", () => {
    expect(() => parseCreateStrataArgs(["demo", "--kit=hobby"])).toThrow(/Unknown option/);
  });
});

describe("create-strata generate", () => {
  test("default app is sqlite headers API without docker compose", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["hobby-app", "--yes"]);

    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("FRONTEND_MODE=api");
    expect(env).toContain("sqlite:./storage/app.sqlite");
    expect(env).toContain("AUTH_DEV_HEADERS=true");
    expect(existsSync(join(app, "docker-compose.yml"))).toBe(false);

    const layers = JSON.parse(await readFile(join(app, "strata.layers.json"), "utf8")) as {
      generatedBy: string;
    };
    expect(layers.generatedBy).toBe("create-strata");

    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("Docker Compose | not needed");
    expect(readme).not.toContain("docker compose up -d");
    expect(readme).not.toContain("Laravel");
    expect(readme).not.toContain("WorkHub");
    expect(readme).not.toContain("—");
    expect(readme).toContain("docs/INTEGRATIONS.md");
    expect(readme).toContain("openapi:generate");
    expect(readme).toContain("openapi:check");

    const modelsRegister = await readFile(join(app, "src/models/register.ts"), "utf8");
    expect(modelsRegister).toContain("@getstrata/bootstrap/discoverModels");
    expect(modelsRegister).toContain("await discoverModels(import.meta.dir)");
    expect(modelsRegister).not.toContain("\nimport { registerModelClass }");
    expect(modelsRegister).not.toContain("void registerModelClass;");
    const noteModel = await readFile(join(app, "src/models/Note.ts"), "utf8");
    expect(noteModel).toContain("class Note extends defineModel(notesTable)");
    expect(noteModel).not.toContain("registerModelRepository");
    expect(noteModel).not.toContain("BaseRepository");
    expect(noteModel).not.toContain("class NoteRepository");
    const bootstrap = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(bootstrap).toContain("createProviderAppContext");
    expect(bootstrap).not.toContain("AppConfigStore");
    expect(bootstrap).not.toContain("as unknown as ConfigStore");
    expect(bootstrap).not.toContain("dependencies as AppDependencies");
    expect(bootstrap).not.toContain("appContext as never");
    const preload = await readFile(join(app, "src/bootstrap/preload.ts"), "utf8");
    expect(preload).toContain("../models/register.ts");
    expect(existsSync(join(app, "src/modules/billing/index.ts"))).toBe(false);
    expect(existsSync(join(app, "src/jobs/dispatchOutboundWebhookJob.ts"))).toBe(false);

    const authProvider = await readFile(join(app, "src/bootstrap/providers/auth.ts"), "utf8");
    expect(authProvider).toContain("envFlagEnabled(process.env.AUTH_DEV_HEADERS)");
    expect(authProvider).not.toContain('AUTH_DEV_HEADERS === "false"');
    const providers = await readFile(join(app, "src/bootstrap/providers/index.ts"), "utf8");
    expect(providers).toContain("policyProvider");
    expect(providers).toContain("registerInvalidateCacheOnModelWriteListeners");
    expect(providers).toContain("discoverListeners");
    expect(providers).toContain("onCleanup(registerInvalidateCacheOnModelWriteListeners())");
    expect(existsSync(join(app, "src/bootstrap/providers/policy.ts"))).toBe(true);

    expect(providers).toContain('import { tracingProvider } from "@getstrata/bootstrap"');
    expect(providers).toContain("  tracingProvider,");

    const queueProvider = await readFile(join(app, "src/bootstrap/providers/queue.ts"), "utf8");
    expect(queueProvider).toContain("registerDefaultJobs");
    expect(queueProvider).toContain("discoverJobs");

    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).not.toContain("createMetricsRoutes");
    expect(createApp).toContain("isProductionEnv()");
    expect(createApp).toContain("discoverModules");
    expect(createApp).toContain("moduleProviders");
    expect(createApp.indexOf("await ensureModulesLoaded()")).toBeLessThan(
      createApp.indexOf("context = await createAppContext();"),
    );
    expect(createApp).toContain(
      "return createProviderAppContext([...starterProviders, ...moduleProviders])",
    );
    expect(createApp).not.toContain("runProviderPhase");
    expect(queueProvider).toContain("register({ container, onCleanup })");
    expect(queueProvider.indexOf("discoverJobs()")).toBeGreaterThan(
      queueProvider.indexOf("register({ container, onCleanup })"),
    );
    expect(readme).not.toContain("GET /metrics");

    const database = await readFile(join(app, "src/bootstrap/database.ts"), "utf8");
    expect(database).toContain("createSqliteConnection");
    expect(database).not.toContain('from "@getstrata/core"');

    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@getstrata/core"]).toBe("^2.2.33");
    expect(pkg.dependencies.eta).toBe("^4.6.0");
    expect(pkg.dependencies.mysql2).toBeUndefined();
    expect(pkg.scripts.dev).toBe("strata dev");
    expect(pkg.scripts["queue:work"]).toBe("strata queue:work");
    expect(existsSync(join(app, "src/cli/register.ts"))).toBe(true);

    expect(readme).toContain("Strata app generated by `create-strata`.");
    expect(readme).not.toContain("dogfood");
    expect(readme).not.toContain("end-to-end");
    expect(readme).not.toContain("apps/hiroapp");

    expect(existsSync(join(app, "src/models/Note.ts"))).toBe(true);
    expect(existsSync(join(app, "src/models/register.ts"))).toBe(true);
    expect(existsSync(join(app, "src/models/User.ts"))).toBe(false);
    expect(existsSync(join(app, "src/models/ApiToken.ts"))).toBe(false);
    const note = await readFile(join(app, "src/models/Note.ts"), "utf8");
    expect(note).toContain("defineModel(notesTable)");
    expect(note).toContain('static $fillable = ["body"]');
    expect(note).not.toContain('from "@getstrata/core"');

    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(migrate).toContain('Note.query().value("id")');
    expect(migrate).toContain('Note.create({ body: "Welcome to Strata!" })');
    expect(migrate).not.toContain("INSERT INTO notes");
    expect(migrate).toContain("migrateDatabase");
    expect(migrate).toContain("loadStarterMigrations");
    expect(migrate).toContain('from "@getstrata/core/database/migrations"');
    expect(migrate).not.toContain("@getstrata/core/database/migrations/runner");
    const schema = await readFile(join(app, "src/db/migrations/0001_starter_schema.ts"), "utf8");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS notes");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS failed_job");

    const site = await readFile(join(app, "src/modules/site/index.ts"), "utf8");
    expect(site).not.toContain("/health");
    const healthBootstrap = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(healthBootstrap).toContain('Note.query().limit(1).select("id").get()');
    expect(healthBootstrap).not.toContain("runWithMigrationBypass");
    expect(site).not.toContain('Note.query().value("id")');
    expect(site).not.toContain("runWithMigrationBypass");
    expect(site).not.toContain("SELECT 1 FROM notes LIMIT 1");

    const api = await readFile(join(app, "docs/API.md"), "utf8");
    expect(api).toContain('.pluck("body", "id")');
    expect(api).toContain("zero rows is still 200");
    expect(api).not.toContain("SELECT id, body FROM notes");
    expect(api).not.toContain("/webhooks");
    expect(api).not.toContain("/billing");
  });

  test("in-repo sibling README is not dogfood copy", async () => {
    const root = await tempDir();
    const name = "hiroapp-hobby";
    generateProject({
      projectName: name,
      targetDir: join(root, name),
      layers: exampleAppLayers("hiroapp-hobby"),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
      inRepoExample: true,
    });
    const readme = await readFile(join(root, name, "README.md"), "utf8");
    expect(readme).toContain("generated sibling layer map");
    expect(readme).toContain("not CI dogfood");
    expect(readme).toContain("apps/hiroapp");
    expect(readme).not.toContain("Strata dogfood for internal end-to-end testing");
    expect(readme).not.toContain("Laravel");
    expect(readme).not.toContain("WorkHub");
    expect(readme).not.toContain("—");
  });

  test("in-repo hiroapp README names it dogfood for internal end-to-end testing", async () => {
    const root = await tempDir();
    const name = "hiroapp";
    generateProject({
      projectName: name,
      targetDir: join(root, name),
      layers: exampleAppLayers("hiroapp"),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
      inRepoExample: true,
      dogfood: true,
    });
    const readme = await readFile(join(root, name, "README.md"), "utf8");
    expect(readme).toContain("Strata dogfood for internal end-to-end testing");
    expect(readme).toContain("bunx create-strata");
    expect(readme).not.toContain("Strata app generated by `create-strata`.");
    expect(readme).not.toContain("Laravel");
    expect(readme).not.toContain("WorkHub");
    expect(readme).not.toContain("—");
  });

  test("postgres HTML with docker writes postgres, redis, and mailpit", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "ent-app",
      "--frontend=server-htmx",
      "--database=postgres",
      "--auth=cookie-token-jwt",
      "--cache=redis",
      "--queue=redis",
      "--mail=smtp",
      "--docker",
      "--yes",
    ]);

    const compose = await readFile(join(app, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).toContain("redis:");
    expect(compose).toContain("mailpit:");
    expect(compose).not.toContain("adminer:");
    expect(compose).toContain("127.0.0.1:5432:5432");
    expect(compose).not.toContain("mysql:");
    expect(compose).toContain("./docker/postgres-init:/docker-entrypoint-initdb.d:ro");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).not.toContain("http://localhost:8080");
    expect(readme).toContain("strata_app");

    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain(
      "postgresql://strata_app:dev-strata-app-change-me@localhost:5432/ent_app",
    );
    expect(env).toContain("NOSUPERUSER NOBYPASSRLS");
    expect(env).toContain("MAIL_TIMEOUT_MS=10000");
    expect(env).toContain("MAIL_SECURE=false");
    expect(env).toContain("STARTTLS is not negotiated");
    expect(env).not.toContain("MYSQL_URL");
    const init = await readFile(join(app, "docker/postgres-init/01-strata-app-role.sql"), "utf8");
    expect(init).toContain("CREATE ROLE strata_app LOGIN");
    expect(init).toContain("NOBYPASSRLS");
    expect(init).toContain("NOSUPERUSER");
    expect(init).toContain("GRANT CONNECT ON DATABASE ent_app TO strata_app");
    expect(init).toContain("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public");
    expect(init).toContain("already-existing volume");
    expect(existsSync(join(app, "db/ensure-postgres-app-role.sql"))).toBe(true);
    const preload = await readFile(join(app, "src/bootstrap/preload.ts"), "utf8");
    expect(preload).toContain(
      "postgresql://strata_app:dev-strata-app-change-me@localhost:5432/ent_app",
    );

    expect(existsSync(join(app, "views/auth/login.eta"))).toBe(true);
    expect(existsSync(join(app, "views/auth/register.eta"))).toBe(true);
    expect(existsSync(join(app, "views/auth/forgot-password.eta"))).toBe(true);
    const css = await readFile(join(app, "public/assets/site.css"), "utf8");
    expect(css).toContain("--accent");
    expect(existsSync(join(app, "src/modules/careers"))).toBe(false);
    expect(existsSync(join(app, "resources/views/organizations"))).toBe(false);

    const auth = await readFile(join(app, "src/bootstrap/providers/auth.ts"), "utf8");
    expect(auth).toContain("createCookieSessionAuthManager");
    expect(auth).toContain("JwtGuard");
  });

  test("postgres --no-docker skips compose and documents local installs", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "team-local",
      "--frontend=server-htmx",
      "--database=postgres",
      "--auth=cookie",
      "--cache=redis",
      "--queue=redis",
      "--no-docker",
      "--yes",
    ]);

    expect(existsSync(join(app, "docker-compose.yml"))).toBe(false);
    expect(existsSync(join(app, "docker/postgres-init/01-strata-app-role.sql"))).toBe(false);
    expect(existsSync(join(app, "db/ensure-postgres-app-role.sql"))).toBe(true);
    const ensureSql = await readFile(join(app, "db/ensure-postgres-app-role.sql"), "utf8");
    expect(ensureSql).toContain("already-existing volume");
    expect(ensureSql).toContain("ALTER ROLE strata_app WITH LOGIN PASSWORD");
    expect(ensureSql).toContain("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public");
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toMatch(
      /^DATABASE_URL=postgresql:\/\/strata_app:dev-strata-app-change-me@localhost:5432\/team_local$/m,
    );
    expect(env).not.toMatch(/^DATABASE_URL=postgresql:\/\/postgres:/m);
    expect(env).toContain(
      "MIGRATION_DATABASE_URL=postgresql://postgres:dev-postgres-change-me@localhost:5432/team_local",
    );
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("off (local installs)");
    expect(readme).toContain("Use local installs for Postgres, Redis");
    expect(readme).not.toContain("docker compose up -d");
  });

  test("--docker-services=postgres writes only postgres", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "team-pg",
      "--database=postgres",
      "--cache=redis",
      "--queue=redis",
      "--docker-services=postgres",
      "--yes",
    ]);

    const compose = await readFile(join(app, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).not.toContain("redis:");
    expect(compose).not.toContain("adminer:");
  });

  test("--docker-services=postgres,adminer writes Adminer next to Postgres", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "team-pg-ui",
      "--database=postgres",
      "--cache=redis",
      "--queue=redis",
      "--docker-services=postgres,adminer",
      "--yes",
    ]);

    const compose = await readFile(join(app, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).toContain("adminer:");
    expect(compose).toContain("ADMINER_DEFAULT_SERVER: postgres");
    expect(compose).not.toContain("redis:");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("Adminer: http://localhost:8080");
    expect(readme).toContain("password `dev-postgres-change-me`");
    expect(readme).toContain("skips FORCE RLS");
  });

  test("example app maps are sqlite API, postgres HTML, and postgres HTMX enterprise", () => {
    expect(exampleAppLayers("hiroapp-hobby").database).toBe("sqlite");
    expect(exampleAppLayers("hiroapp-team").frontend).toBe("server-htmx");
    expect(exampleAppLayers("hiroapp").frontend).toBe("server-htmx");
    expect(exampleAppLayers("hiroapp").database).toBe("postgres");
    expect(exampleAppLayers("hiroapp").tenancy).toBe("rls");
    expect(exampleAppLayers("hiroapp").docker.services.mysql).toBe(false);
    expect(exampleAppLayers("hiroapp-hobby").docker.services.adminer).toBe(false);
    expect(exampleAppLayers("hiroapp-team").docker.services.adminer).toBe(false);
    expect(exampleAppLayers("hiroapp").docker.services.adminer).toBe(false);
    expect(defaultLayers().database).toBe("sqlite");
  });

  test("sqlite coerces --tenancy=rls to column because RLS is Postgres-only", () => {
    const sqlite = layersFromFlags(
      parseCreateStrataArgs(["demo", "--database=sqlite", "--tenancy=rls", "--yes"]),
    );
    expect(sqlite.tenancy).toBe("column");
    const mysql = layersFromFlags(
      parseCreateStrataArgs(["demo", "--database=mysql", "--tenancy=rls", "--yes"]),
    );
    expect(mysql.tenancy).toBe("column");
  });

  test("sqlite --tenancy=column writes a tenant table", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "tenant-sqlite",
      "--database=sqlite",
      "--auth=cookie",
      "--tenancy=column",
      "--yes",
    ]);
    const schema = await readFile(join(app, "src/db/migrations/0001_starter_schema.ts"), "utf8");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS tenant");
    expect(schema).toContain("tenant_id");
    expect(schema).not.toContain("plan TEXT");
    expect(schema).not.toContain("region TEXT");
    const seed = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(seed).not.toContain("slug, plan, region");
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("TENANCY_DRIVER=column");
  });

  test("postgres rls writes a tenant table and keeps the database name from DATABASE_URL", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "acme",
      "--frontend=server-htmx",
      "--database=postgres",
      "--auth=cookie-token-jwt",
      "--tenancy=rls",
      "--yes",
    ]);
    const schema = await readFile(join(app, "src/db/migrations/0001_starter_schema.ts"), "utf8");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS tenant");
    expect(schema).toContain("ALTER TABLE notes FORCE ROW LEVEL SECURITY");
    expect(schema).toContain("ALTER TABLE users FORCE ROW LEVEL SECURITY");
    expect(schema).toContain("ALTER TABLE sessions FORCE ROW LEVEL SECURITY");
    expect(schema).toContain("ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY");
    expect(schema).toContain("ALTER TABLE auth_one_time_tokens FORCE ROW LEVEL SECURITY");
    expect(schema).toContain("u.id = sessions.user_id");
    expect(schema).toContain("u.id = auth_one_time_tokens.user_id");
    expect(schema).toContain("auth_saml_assertions");
    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    const seedFn = migrate.slice(migrate.indexOf("export async function seed"));
    expect(seedFn.indexOf("getSql()")).toBeGreaterThan(-1);
    expect(seedFn.indexOf("getSql()")).toBeLessThan(seedFn.indexOf("runWithMigrationBypass(async"));
    const authModule = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
    expect(authModule).toContain("completePasswordLogin");
    expect(authModule).toMatch(/"\/api\/v1\/auth\/login":[\s\S]*?wrapLogin\(/);
    expect(authModule).toMatch(/"\/api\/auth\/token":[\s\S]*?wrapLogin\(/);
    expect(authModule).toContain("runWithMigrationBypassForIdentifier");
    expect(authModule).toContain("runAuthWrite");
    expect(authModule).toContain("createOAuthState()");
    expect(authModule).not.toContain("createOAuthStateCookie");
    expect(authModule).toContain("JSON.stringify([])");
    expect(authModule).toContain("abilities: []");
    expect(authModule).toContain("User.create({");
    expect(authModule).toContain("ApiToken.create({");
    expect(authModule).not.toContain("FROM users");
    expect(authModule).not.toContain("INTO users");
    expect(authModule).not.toContain("INTO api_tokens");
    expect(await readFile(join(app, "src/bootstrap/providers/auth.ts"), "utf8")).toContain(
      "new JwtGuard(container)",
    );
    expect(existsSync(join(app, "src/bootstrap/ensureDatabase.ts"))).toBe(true);
    const ensure = await readFile(join(app, "src/bootstrap/ensureDatabase.ts"), "utf8");
    // The database name must come from DATABASE_URL, never a hardcoded rename.
    expect(ensure).toContain("resolveAppDatabaseUrl");
    expect(ensure).not.toContain("acme_test");
    expect(ensure).not.toMatch(/url\.pathname\s*=/);
    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).toContain("assertRlsLiveDatabaseRole");
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("/acme");
    expect(env).toMatch(
      /^DATABASE_URL=postgresql:\/\/strata_app:dev-strata-app-change-me@localhost:5432\/acme$/m,
    );
    expect(env).not.toMatch(/^DATABASE_URL=postgresql:\/\/postgres:/m);
    expect(env).toContain(
      "MIGRATION_DATABASE_URL=postgresql://postgres:dev-postgres-change-me@localhost:5432/acme",
    );
    expect(env).not.toContain("acme_test");
    expect(env).not.toContain("MYSQL_URL");
    expect(existsSync(join(app, "db/ensure-postgres-app-role.sql"))).toBe(true);
    expect(existsSync(join(app, "docker/postgres-init/01-strata-app-role.sql"))).toBe(false);
    const fresh = await readFile(join(app, "src/db/fresh.ts"), "utf8");
    expect(fresh).toContain("freshDatabase");
    expect(fresh).toContain("{ destructive: true }");
    expect(fresh).toContain("if (isProductionEnv())");
    expect(fresh).toContain("withMigrationDatabase");
    expect(fresh).toContain('from "@getstrata/core/database/migrations"');
    expect(fresh).not.toContain("@getstrata/core/database/migrations/runner");
    expect(fresh).not.toContain("getSql()");
    const rollback = await readFile(join(app, "src/db/rollback.ts"), "utf8");
    expect(rollback).toContain("rollbackDatabase");
    expect(rollback).toContain("withMigrationDatabase");
  });

  test("postgres rls with docker still ships repeatable SQL and a NOBYPASSRLS URL", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "acme-docker",
      "--frontend=server-htmx",
      "--database=postgres",
      "--auth=cookie",
      "--tenancy=rls",
      "--docker",
      "--yes",
    ]);
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toMatch(
      /^DATABASE_URL=postgresql:\/\/strata_app:dev-strata-app-change-me@localhost:5432\/acme_docker$/m,
    );
    expect(env).not.toMatch(/^DATABASE_URL=postgresql:\/\/postgres:/m);
    const init = await readFile(join(app, "docker/postgres-init/01-strata-app-role.sql"), "utf8");
    const ensure = await readFile(join(app, "db/ensure-postgres-app-role.sql"), "utf8");
    expect(init).toBe(ensure);
    expect(init).toContain("already-existing volume");
    expect(init).toContain("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public");
    const site = await readFile(join(app, "src/modules/site/index.ts"), "utf8");
    expect(site).not.toContain("/health");
    const healthBootstrap = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(healthBootstrap).toContain('Note.query().limit(1).select("id").get()');
    expect(healthBootstrap).not.toContain("runWithMigrationBypass");
    expect(site).not.toContain("runWithMigrationBypass");
  });

  test("cookie extras write MFA schema, verify views, and a SCIM module", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "extras-app",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie",
      "--mfa",
      "--email-verification",
      "--scim",
      "--yes",
    ]);
    const schema = await readFile(join(app, "src/db/migrations/0001_starter_schema.ts"), "utf8");
    expect(schema).toContain("mfa_secret");
    expect(schema).toContain("mfa_enabled");
    expect(existsSync(join(app, "views/auth/mfa-challenge.eta"))).toBe(true);
    expect(existsSync(join(app, "views/auth/verify-email.eta"))).toBe(true);
    expect(existsSync(join(app, "src/bootstrap/pendingMfa.ts"))).toBe(true);
    const scim = await readFile(join(app, "src/modules/scim/index.ts"), "utf8");
    expect(scim).toContain("/scim/v2/Users");
    expect(scim).toContain("createScimAuthMiddleware");
    const auth = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
    expect(auth).toContain("/register");
    expect(auth).toContain("/forgot-password");
    expect(auth).toContain("/email/verify");
    expect(auth).toContain("if (record.mfa_enabled)");
    expect(auth).toContain("pendingMfaSetCookie(record.id)");
    expect(auth).toContain("await revokeUserSessions(Number(user.id))");
    expect(auth).toContain("kernel.wrapWebPasswordConfirm(");
    expect(auth).toMatch(/"\/reset-password":[\s\S]*?wrapWeb\(kernel\.wrapSigned\(/);
    expect(auth).toContain("assertValidSignature(request)");
    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).not.toContain("createMetricsRoutes");
  });

  test("generated SCIM, auth, and seed use User and ApiToken models", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "model-app",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie-token",
      "--tenancy=column",
      "--scim",
      "--mfa",
      "--yes",
    ]);
    const scim = await readFile(join(app, "src/modules/scim/index.ts"), "utf8");
    expect(scim).toContain("User.where({ email, tenant_id: tenantId() }).first()");
    expect(scim).toContain("User.where({ tenant_id: tenantId() }).count()");
    expect(scim).toContain(
      "User.where({ tenant_id: tenantId() }).offset(startIndex - 1).limit(count).get()",
    );
    expect(scim).toContain("User.where({ id, tenant_id: tenantId() }).first()");
    expect(scim).toContain("parsePositiveIntParam");
    expect(scim).toContain("User.create({");
    expect(scim).toContain("tenant_id: tenantId()");
    expect(scim).toContain("user.update({ name, email })");
    expect(scim).toContain("user.delete()");
    expect(scim).not.toContain("FROM users");
    expect(scim).not.toContain("INTO users");
    expect(scim).not.toContain("runWithMigrationBypass(");
    expect(scim).not.toContain("as User");
    expect(scim).not.toContain("User.where({ tenant_id: tenantId() }).get()");

    const auth = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
    expect(auth).toContain("User.create({");
    expect(auth).toContain("ApiToken.create({");
    expect(auth).toContain("AuthOneTimeToken.create({");
    expect(auth).toContain("JSON.stringify([])");
    expect(auth).toContain("parseJsonBody(request, parseRegisterCredentials)");
    expect(auth).toContain("validateObject");
    expect(auth).toContain("emailRule()");
    expect(auth).toContain("minLength(8)");
    expect(auth).toContain("kernel.wrapWebPasswordConfirm(");
    expect(auth).toMatch(/"\/reset-password":[\s\S]*?wrapWeb\(kernel\.wrapSigned\(/);
    expect(auth).toMatch(/"\/api\/v1\/auth\/reset-password":[\s\S]*?wrapSigned\(/);
    expect(auth).not.toContain("isValidEmail");
    expect(auth).not.toContain("hasFreshPasswordConfirmation");
    expect(auth).not.toContain("FROM users");
    expect(auth).not.toContain("INTO users");
    expect(auth).not.toContain("INTO api_tokens");
    expect(auth).not.toContain("INTO auth_one_time_tokens");

    const providers = await readFile(join(app, "src/bootstrap/providers/index.ts"), "utf8");
    expect(providers).toContain("policyProvider");
    expect(providers).toContain("authProvider");
    const policy = await readFile(join(app, "src/bootstrap/providers/policy.ts"), "utf8");
    expect(policy).toContain("CORE_POLICY_GATE_TOKEN");
    expect(policy).toContain("new PolicyGate()");
    expect(policy).toContain("@getstrata/core/auth/policy");
    expect(policy).toContain("@getstrata/bootstrap/config");

    const directory = await readFile(join(app, "src/bootstrap/authDirectory.ts"), "utf8");
    expect(directory).toContain("User.where({ email }).first()");
    expect(directory).toContain("User.find(id)");
    expect(directory).toContain("ApiToken.where({ token_hash: hashed }).first()");
    expect(directory).toContain("User.find(user_id)");
    expect(directory).toContain("runWithMigrationBypassForIdentifier(hashed");
    expect(directory).toContain("runWithMigrationBypassForIdentifier(user_id");
    expect(directory).not.toContain("JOIN");
    expect(directory).not.toContain("FROM users");
    expect(directory).not.toContain("FROM api_tokens");
    expect(directory).toContain('user.get("password")');
    expect(directory).not.toContain("toArray()");
    expect(directory).not.toContain("as User");
    expect(directory).toContain("function mapUserRow(user: LoadedUser): AuthUserRecord");
    expect(directory).toContain('asTimestamp(user.get("email_verified_at"))');
    expect(directory).toContain('asTimestamp(user.get("session_valid_after"))');
    expect(directory).toContain('asNullableString(user.get("mfa_secret"))');

    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(migrate).toContain("User.create({");
    expect(migrate).toContain('User.query().value("id")');
    expect(migrate).not.toContain("INSERT INTO users");
    expect(migrate).not.toContain("INSERT INTO notes");

    const userModel = await readFile(join(app, "src/models/User.ts"), "utf8");
    expect(userModel).toContain(
      'static $hidden = ["password", "mfa_secret", "mfa_recovery_codes"]',
    );
    expect(userModel).toContain("static $timestamps = false");
    expect(userModel).toContain("tenant_id");
    expect(existsSync(join(app, "src/models/ApiToken.ts"))).toBe(true);
    expect(existsSync(join(app, "src/models/AuthOneTimeToken.ts"))).toBe(true);
  });

  test("metrics extra writes GET /metrics and a token", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["metrics-app", "--metrics", "--yes"]);
    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).toContain("createMetricsRoutes");
    expect(createApp).toContain("runtimeMetrics?: MetricsRuntimeOptions");
    expect(createApp).toContain("createMetricsRuntime(options.runtimeMetrics)");
    expect(createApp).toContain('onCleanup(() => metricsRuntime.close(), "drain")');
    expect(createApp).toContain("...metricsProviders");
    expect(createApp).toContain("() => metricsRuntime?.close(), closeDatabase");
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("METRICS_TOKEN=dev-metrics-token-change-me");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("GET /metrics");
  });

  test("token API apps write JSON register and password reset", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["token-app", "--auth=token", "--yes"]);
    const auth = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
    expect(auth).toContain("/api/v1/auth/register");
    expect(auth).toContain("/api/v1/auth/forgot-password");
    expect(auth).toContain("parseJsonBody(request, parseRegisterCredentials)");
    expect(auth).toContain("validateObject");
    expect(auth).toMatch(/"\/api\/v1\/auth\/reset-password":[\s\S]*?wrapSigned\(/);
    expect(existsSync(join(app, "views/auth/login.eta"))).toBe(false);
  });

  test("refuses an existing directory without --force", async () => {
    const root = await tempDir();
    generateFromArgs(root, ["taken", "--yes"]);
    expect(() => generateFromArgs(root, ["taken", "--yes"])).toThrow(/already exists/);
  });
});

describe("create-strata CLI", () => {
  test("prints help without kit levels", async () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "packages/strata-starter/cli.ts", "--help"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("create-strata");
    expect(out).toContain("--frontend");
    expect(out).toContain("--docker");
    expect(out).toContain("adminer");
    expect(out).not.toContain("--kit");
    expect(out).not.toContain("hiroapp-enterprise");
  });

  test("scaffolds with --yes", async () => {
    const root = await tempDir();
    const result = Bun.spawnSync({
      cmd: ["bun", join(repoRoot, "packages/strata-starter/cli.ts"), "cli-hobby", "--yes"],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("bun run db:migrate");
    expect(out).toContain("bun run dev");
    expect(out).toContain("docker=none");
    expect(out).not.toContain("docker compose up -d");
    expect(existsSync(join(root, "cli-hobby/src/bootstrap/createApp.ts"))).toBe(true);
  });

  test("scaffolds postgres HTML with --no-docker", async () => {
    const root = await tempDir();
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        join(repoRoot, "packages/strata-starter/cli.ts"),
        "cli-team-local",
        "--frontend",
        "server-htmx",
        "--database",
        "postgres",
        "--auth",
        "cookie",
        "--cache",
        "redis",
        "--queue",
        "redis",
        "--no-docker",
        "--yes",
      ],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("docker=local");
    expect(out).toContain("Point env at local postgres, redis");
    expect(existsSync(join(root, "cli-team-local/docker-compose.yml"))).toBe(false);
  });

  test("wizard always asks each layer", async () => {
    const layers = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["api", "sqlite", "headers", "none", "array", "sync", "log"],
        multiSelect: [[]],
      }),
    );
    expect(layers.frontend).toBe("api");
    expect(layers.database).toBe("sqlite");
    expect(layers.docker.enabled).toBe(false);
    expect(layers.extras).toEqual({
      mfa: false,
      emailVerification: false,
      scim: false,
      metrics: false,
      oauthGithub: false,
      oidc: false,
      billing: false,
      webhooks: false,
    });
  });

  test("wizard can choose local tools or a docker mix", async () => {
    const local = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["server-htmx", "postgres", "cookie", "none", "redis", "redis", "log", "local"],
        multiSelect: [[]],
      }),
    );
    expect(local.docker.enabled).toBe(false);

    const mix = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["server-htmx", "postgres", "cookie", "none", "redis", "redis", "log", "mix"],
        multiSelect: [[]],
        confirm: [true, false, true],
      }),
    );
    expect(mix.docker.services.postgres).toBe(true);
    expect(mix.docker.services.redis).toBe(false);
    expect(mix.docker.services.adminer).toBe(true);

    const dbLocal = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["server-htmx", "postgres", "cookie", "none", "redis", "redis", "log", "mix"],
        multiSelect: [[]],
        confirm: [false, true],
      }),
    );
    expect(dbLocal.docker.services.postgres).toBe(false);
    expect(dbLocal.docker.services.redis).toBe(true);
    expect(dbLocal.docker.services.adminer).toBe(false);
  });

  test("wizard extras list can enable MFA and SCIM one by one", async () => {
    const layers = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["api", "sqlite", "cookie", "none", "array", "sync", "log"],
        multiSelect: [["mfa", "scim"]],
      }),
    );
    expect(layers.extras.mfa).toBe(true);
    expect(layers.extras.scim).toBe(true);
    expect(layers.extras.emailVerification).toBe(false);
    expect(layers.extras.metrics).toBe(false);
  });

  test("wizard extras omit MFA and SCIM when auth has no users", async () => {
    let extraValues: string[] = [];
    const layers = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["api", "sqlite", "headers", "none", "array", "sync", "log"],
        multiSelect: [["metrics"]],
        onMultiSelect: (_message, values) => {
          extraValues = values;
        },
      }),
    );
    expect(extraValues).toEqual(["metrics", "billing", "webhooks"]);
    expect(layers.extras.mfa).toBe(false);
    expect(layers.extras.scim).toBe(false);
    expect(layers.extras.emailVerification).toBe(false);
    expect(layers.extras.metrics).toBe(true);
  });

  test("wizard extras skip items already set by flags", async () => {
    let extraValues: string[] = [];
    const layers = await promptLayers(
      parseCreateStrataArgs(["demo", "--no-metrics"]),
      scriptedPrompter({
        select: ["api", "sqlite", "headers", "none", "array", "sync", "log"],
        multiSelect: [[]],
        onMultiSelect: (_message, values) => {
          extraValues = values;
        },
      }),
    );
    expect(extraValues).toEqual(["billing", "webhooks"]);
    expect(layers.extras.metrics).toBe(false);
    expect(layers.extras.billing).toBe(false);
    expect(layers.extras.webhooks).toBe(false);

    extraValues = [];
    const cookie = await promptLayers(
      parseCreateStrataArgs(["demo", "--no-metrics"]),
      scriptedPrompter({
        select: ["api", "sqlite", "cookie", "none", "array", "sync", "log"],
        multiSelect: [[]],
        onMultiSelect: (_message, values) => {
          extraValues = values;
        },
      }),
    );
    expect(extraValues).toEqual([
      "mfa",
      "emailVerification",
      "scim",
      "oauthGithub",
      "oidc",
      "billing",
      "webhooks",
    ]);
    expect(cookie.extras.metrics).toBe(false);

    const allFlagged = await promptLayers(
      parseCreateStrataArgs(["demo", "--mfa", "--email-verification", "--scim", "--metrics"]),
      scriptedPrompter({
        select: ["api", "sqlite", "cookie", "none", "array", "sync", "log"],
        multiSelect: [[]],
      }),
    );
    expect(allFlagged.extras).toEqual({
      mfa: true,
      emailVerification: true,
      scim: true,
      metrics: true,
      oauthGithub: false,
      oidc: false,
      billing: false,
      webhooks: false,
    });
  });

  test("token auth extras omit MFA pages but still offer SCIM and metrics", async () => {
    let extraValues: string[] = [];
    await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["api", "sqlite", "token", "none", "array", "sync", "log"],
        multiSelect: [[]],
        onMultiSelect: (_message, values) => {
          extraValues = values;
        },
      }),
    );
    expect(extraValues).toEqual(["emailVerification", "scim", "metrics", "billing", "webhooks"]);
  });

  appTest("generated bootstrap awaits module registration before starter boot", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["probe-providers", "--yes"]);
    const repo = repoRoot;
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies["@getstrata/core"] = `file:${join(repo, "packages/strata-core")}`;
    pkg.dependencies["@getstrata/bootstrap"] = `file:${join(repo, "packages/strata-bootstrap")}`;
    pkg.dependencies["@getstrata/cli"] = `file:${join(repo, "packages/strata-cli")}`;
    await Bun.write(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

    const probeDir = join(app, "src/modules/probe");
    await mkdir(probeDir, { recursive: true });
    await writeFile(
      join(probeDir, "index.ts"),
      `import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import type { ServiceProvider } from "@getstrata/core/contracts/di";

export const PROBE_REGISTER_TOKEN = "probe.module.register.token";
export const PROBE_BOOT_TOKEN = "probe.module.boot.token";

const probeProvider: ServiceProvider = {
  name: "probe.provider",
  async register({ container, onCleanup }) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    onCleanup(() => { container.set("probe.closed", true); });
    container.singleton(PROBE_REGISTER_TOKEN, () => "module-provider-register");
  },
  async boot({ container }) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("probe", { view: () => true });
    container.singleton(PROBE_BOOT_TOKEN, () => "module-provider-boot");
  },
};

const probeModule: AppModule = {
  name: "probe",
  providers: [probeProvider],
};

export default probeModule;
`,
    );

    const providerIndex = join(app, "src/bootstrap/providers/index.ts");
    const providerSource = await readFile(providerIndex, "utf8");
    await writeFile(
      providerIndex,
      providerSource.replace(
        "  async boot({ onCleanup }) {",
        `  async boot({ onCleanup, container }) {
    if (container.resolve("probe.module.register.token") !== "module-provider-register") throw new Error("starter boot ran before module registration");`,
      ),
    );

    installGeneratedAppDependencies(app);

    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "api";
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.TENANCY_DRIVER = "none";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";
    resetDiscoverModulesForTests();

    try {
      const { bootstrapApp } = await import(`${join(app, "src/bootstrap/createApp.ts")}`);
      const { PROBE_BOOT_TOKEN, PROBE_REGISTER_TOKEN } = await import(
        `${join(probeDir, "index.ts")}`
      );
      const { closeDatabase } = await import(`${join(app, "src/bootstrap/database.ts")}`);

      const { context } = await bootstrapApp({ migrate: false });
      expect(context.container.resolve(PROBE_REGISTER_TOKEN)).toBe("module-provider-register");
      expect(context.container.resolve(PROBE_BOOT_TOKEN)).toBe("module-provider-boot");
      expect(context.config).toBeInstanceOf(ConfigStore);
      context.config.set("generator.probe", "shared-store");
      expect(context.config.require("generator.probe")).toBe("shared-store");
      expect(() => context.config.require("generator.missing")).toThrow(
        'Config key "generator.missing" is not defined.',
      );
      await context.dispose();
      expect(context.container.resolve("probe.closed")).toBe(true);
      await closeDatabase();
    } finally {
      resetDiscoverModulesForTests();
      process.chdir(repoRoot);
    }
  });

  appTest("generated metrics read the migrated outbox instead of creating one", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["metrics-runtime-boot", "--metrics", "--yes"]);
    const packagePath = join(app, "package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    for (const name of ["core", "bootstrap", "cli"]) {
      pkg.dependencies[`@getstrata/${name}`] = `file:${join(repoRoot, `packages/strata-${name}`)}`;
    }
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    installGeneratedAppDependencies(app);
    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "api";
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.TENANCY_DRIVER = "none";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";
    process.env.METRICS_TOKEN = "generated-metrics-fixture";
    resetDiscoverModulesForTests();
    const { bootstrapApp, createAppServer } = await import(join(app, "src/bootstrap/createApp.ts"));
    const { closeDatabase, getSql } = await import(join(app, "src/bootstrap/database.ts"));
    let context: Awaited<ReturnType<typeof bootstrapApp>>["context"] | undefined;
    let server: ReturnType<typeof createAppServer> | undefined;
    try {
      const boot = await bootstrapApp({ runtimeMetrics: { outbox: {}, failedJobs: {} } });
      context = boot.context;
      server = createAppServer(boot.routes, 0);
      const scrape = () =>
        fetch(`http://localhost:${server?.port}/metrics`, {
          headers: { authorization: "Bearer generated-metrics-fixture" },
        }).then((response) => response.text());
      const body = await scrape();
      expect(body).toContain("http_requests_total");
      expect(body).toContain("strata_outbox_collector_success 1");
      expect(body).toContain('strata_outbox_deliveries_sample{state="pending_due"} 0');
      expect(body).toContain("strata_queue_failed_job_collector_success 1");
      // Dev boot runs file migrations. The collector only reads strata_outbox_*.
      const tables = await getSql().unsafe("SELECT name FROM sqlite_master WHERE type='table'");
      expect(tables.some((row: { name: string }) => row.name === "strata_outbox_delivery")).toBe(
        true,
      );
      server.stop(true);
      server = undefined;
      await context.drain();
      await context.dispose();
      // Invalid runtime options must also follow the generated startup cleanup path.
      await expect(
        bootstrapApp({ runtimeMetrics: { failedJobs: { sampleLimit: 0 } } }),
      ).rejects.toThrow();
    } finally {
      server?.stop(true);
      await context?.dispose();
      await closeDatabase();
    }
  });

  appTest("sqlite API app boots and answers GET /health", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["boot-hobby", "--yes"]);
    const repo = repoRoot;
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies["@getstrata/core"] = `file:${join(repo, "packages/strata-core")}`;
    pkg.dependencies["@getstrata/bootstrap"] = `file:${join(repo, "packages/strata-bootstrap")}`;
    pkg.dependencies["@getstrata/cli"] = `file:${join(repo, "packages/strata-cli")}`;
    await Bun.write(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

    installGeneratedAppDependencies(app);

    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "api";
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.TENANCY_DRIVER = "none";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";

    try {
      const { bootstrapApp, createAppServer } = await import(
        `${join(app, "src/bootstrap/createApp.ts")}`
      );
      const { closeDatabase } = await import(`${join(app, "src/bootstrap/database.ts")}`);

      // Unmigrated database: the process is up but must not enter rotation.
      const unmigrated = await bootstrapApp({ migrate: false });
      const coldServer = createAppServer(unmigrated.routes, 0);
      try {
        const cold = await fetch(`http://127.0.0.1:${coldServer.port}/health`);
        expect(cold.status).toBe(503);
        expect(await cold.text()).toBe("degraded");
        // /ready only pings; on an unmigrated SQLite file it is 200, which is why /health is the gate.
        const ready = await fetch(`http://127.0.0.1:${coldServer.port}/ready`);
        expect(ready.status).toBe(200);
        expect(ready.headers.get("content-type")).toContain("application/json");
        const readyBody = (await ready.json()) as { status: string; checks?: unknown };
        expect(readyBody).toMatchObject({ status: "ready" });
        expect(readyBody.checks).toBeUndefined();
      } finally {
        coldServer.stop();
      }

      const { routes } = await bootstrapApp();
      await (await import(join(app, "src/db/migrate.ts"))).seed();
      const server = createAppServer(routes, 0);
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/health`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
      } finally {
        server.stop();
        await closeDatabase();
      }
    } finally {
      process.chdir(repoRoot);
    }
  });

  test("HTML generators use the scoped provider and opt into fragments only on the welcome route", async () => {
    const root = await tempDir();
    for (const auth of ["cookie", "headers", "token", "jwt"]) {
      const app = generateFromArgs(root, [
        `views-${auth}`,
        "--frontend=server-htmx",
        "--database=sqlite",
        `--auth=${auth}`,
        "--oidc",
        "--yes",
      ]);
      expect(existsSync(join(app, "src/lib/view.ts"))).toBe(false);
      const provider = await readFile(join(app, "src/bootstrap/providers/view.ts"), "utf8");
      expect(provider).toContain("createViewProvider");
      expect(provider).toContain('userKey: "currentUser"');
      expect(provider).not.toContain("EtaViewEngine");
      expect(await readFile(join(app, "src/bootstrap/providers/index.ts"), "utf8")).toContain(
        "  viewProvider,",
      );
      const site = await readFile(join(app, "src/modules/site/index.ts"), "utf8");
      expect(site).toContain("resolve(CORE_VIEW_RENDERER_TOKEN)");
      expect(site).toContain("views.renderHtmx(");
      if (auth === "cookie") {
        const authModule = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
        expect(authModule).toContain("views.render(");
        expect(authModule).toContain('.namespace("auth")');
        expect(authModule).not.toContain('views.render("auth/');
        expect(authModule).toContain("status: 429");
        expect(authModule).not.toContain("renderHtmx");
        expect(provider).toContain('process.env.FEATURE_OAUTH === "true"');
      }
    }
  });

  appTest(
    "generated SQLite column tenancy resolves repeated SCIM and authenticated requests",
    async () => {
      const root = await tempDir();
      const app = generateFromArgs(root, [
        "tenant-runtime",
        "--frontend=api",
        "--database=sqlite",
        "--auth=cookie-token-jwt",
        "--tenancy=column",
        "--scim",
        "--yes",
      ]);
      const packagePath = join(app, "package.json");
      const pkg = JSON.parse(await readFile(packagePath, "utf8"));
      for (const name of ["core", "bootstrap", "cli"])
        pkg.dependencies[`@getstrata/${name}`] =
          `file:${join(repoRoot, `packages/strata-${name}`)}`;
      await writeFile(packagePath, JSON.stringify(pkg));
      installGeneratedAppDependencies(app);
      process.chdir(app);
      Object.assign(process.env, {
        DATABASE_URL: "sqlite:./storage/app.sqlite",
        APP_DATABASE_URL: "sqlite:./storage/app.sqlite",
        APP_ENV: "local",
        FRONTEND_MODE: "api",
        TENANCY_DRIVER: "column",
        AUTH_DEV_HEADERS: "false",
        SESSION_SECRET: "dev-tenant-secret-at-least-32-characters",
        MAIL_DRIVER: "log",
        CACHE_DRIVER: "array",
        QUEUE_DRIVER: "sync",
        FEATURE_SCIM: "true",
        SCIM_BEARER_TOKEN: "",
        SCIM_TENANT_TOKENS: "1:fixture-first,2:fixture-second,999:fixture-missing",
        REDIS_URL: "",
      });
      resetDiscoverModulesForTests();
      const { bootstrapApp, createAppServer } = await import(
        join(app, "src/bootstrap/createApp.ts")
      );
      const { closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      const { User } = await import(join(app, "src/models/User.ts"));
      const { BaseRepository } = await import("@getstrata/core/database/baseRepository");
      const { defineTable } = await import("@getstrata/core/database/table");
      const { hashPassword } = await import("@getstrata/core/auth/password");
      const boot = await bootstrapApp();
      const server = createAppServer(boot.routes, 0),
        origin = `http://127.0.0.1:${server.port}`;
      process.env.APP_URL = origin;
      try {
        const tenants = new BaseRepository(
          defineTable<{ id: number; slug: string }, "id">({
            name: "tenant",
            primaryKey: "id",
            columns: ["id", "slug"],
          }),
        );
        await tenants.create({ slug: "first" });
        await tenants.create({ slug: "second" });
        const password = await hashPassword("Initial!Password123");
        const first = await User.create({
          name: "First",
          email: "tenant-first@example.test",
          password,
          is_admin: false,
          tenant_id: 1,
        });
        const second = await User.create({
          name: "Second",
          email: "tenant-second@example.test",
          password,
          is_admin: false,
          tenant_id: 2,
        });
        async function scim(token: string, path = "Users", method = "GET", payload?: object) {
          const response = await fetch(`${origin}/scim/v2/${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" },
            body: payload ? JSON.stringify(payload) : undefined,
          });
          const body: unknown = await response.json();
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new Error("Expected SCIM object.");
          return { status: response.status, body: body as Record<string, unknown> };
        }
        function resourceIds(value: unknown) {
          if (!Array.isArray(value)) throw new Error("Expected SCIM Resources array.");
          return value.map((item: unknown) => {
            if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string")
              throw new Error("Expected SCIM resource identifier.");
            return item.id;
          });
        }
        // SCIM cleans up its bound connection; later calls must use the registered pool safely.
        for (let round = 0; round < 3; round++) {
          const own = await scim("fixture-second");
          expect(own.status).toBe(200);
          expect(resourceIds(own.body.Resources)).toEqual([String(second.get("id"))]);
          expect((await scim("fixture-first", `Users/${second.get("id")}`)).status).toBe(404);
          const other = await scim("fixture-first");
          expect(other.status).toBe(200);
          expect(resourceIds(other.body.Resources)).toEqual([String(first.get("id"))]);
          expect((await scim("fixture-missing")).status).toBe(401);
          const protectedResponse = await fetch(`${origin}/api/user`, {
            headers: {
              authorization: `Basic ${btoa("tenant-second@example.test:Initial!Password123")}`,
            },
          });
          expect(protectedResponse.status).toBe(200);
          expect(await protectedResponse.json()).toMatchObject({ id: second.get("id") });
        }
        const created = await scim("fixture-second", "Users", "POST", {
          userName: "tenant-created@example.test",
          displayName: "Created",
        });
        expect(created.status).toBe(201);
        expect((await User.find(Number(created.body.id))).get("tenant_id")).toBe(2);
        expect(
          (
            await scim("fixture-first", `Users/${created.body.id}`, "PUT", {
              userName: "wrong@example.test",
              displayName: "Wrong",
            })
          ).status,
        ).toBe(404);
        expect((await User.find(Number(created.body.id))).get("email")).toBe(
          "tenant-created@example.test",
        );
      } finally {
        server.stop(true);
        await boot.context.dispose();
        await closeDatabase();
      }
    },
  );

  appTest(
    "generated SCIM mutations reject unsupported changes without partial writes",
    async () => {
      for (const tenancy of ["none", "column"]) {
        const root = await tempDir();
        const app = generateFromArgs(root, [
          "scim-runtime",
          "--frontend=api",
          "--database=sqlite",
          "--auth=cookie-token-jwt",
          `--tenancy=${tenancy}`,
          "--scim",
          "--yes",
        ]);
        const packagePath = join(app, "package.json");
        const pkg = JSON.parse(await readFile(packagePath, "utf8"));
        for (const name of ["core", "bootstrap", "cli"])
          pkg.dependencies[`@getstrata/${name}`] =
            `file:${join(repoRoot, `packages/strata-${name}`)}`;
        await writeFile(packagePath, JSON.stringify(pkg));
        installGeneratedAppDependencies(app);
        process.chdir(app);
        Object.assign(process.env, {
          DATABASE_URL: "sqlite:./storage/app.sqlite",
          APP_DATABASE_URL: "sqlite:./storage/app.sqlite",
          APP_ENV: "local",
          FRONTEND_MODE: "api",
          TENANCY_DRIVER: tenancy,
          AUTH_DEV_HEADERS: "false",
          SESSION_SECRET: "dev-scim-secret-at-least-32-characters",
          MAIL_DRIVER: "log",
          CACHE_DRIVER: "array",
          QUEUE_DRIVER: "sync",
          FEATURE_SCIM: "true",
          SCIM_BEARER_TOKEN: "",
          SCIM_TENANT_TOKENS: "1:fixture-scim-one,2:fixture-scim-two",
          REDIS_URL: "",
        });
        resetDiscoverModulesForTests();
        const { bootstrapApp, createAppServer } = await import(
          join(app, "src/bootstrap/createApp.ts")
        );
        const { closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
        const { User } = await import(join(app, "src/models/User.ts"));
        const { BaseRepository } = await import("@getstrata/core/database/baseRepository");
        const { defineTable } = await import("@getstrata/core/database/table");
        const { hashPassword } = await import("@getstrata/core/auth/password");
        const boot = await bootstrapApp();
        const server = createAppServer(boot.routes, 0),
          origin = `http://127.0.0.1:${server.port}`;
        process.env.APP_URL = origin;
        try {
          const tenants = new BaseRepository(
            defineTable<{ id: number; slug: string }, "id">({
              name: "tenant",
              primaryKey: "id",
              columns: ["id", "slug"],
            }),
          );
          if (tenancy === "column") {
            await tenants.create({ slug: "first" });
            await tenants.create({ slug: "second" });
          }
          const password = await hashPassword("Initial!Password123");
          const target = await User.create({
            name: "Original",
            email: "scim-target@example.test",
            password,
            is_admin: false,
            tenant_id: 2,
          });
          const neighbor = await User.create({
            name: "Neighbor",
            email: "scim-neighbor@example.test",
            password,
            is_admin: false,
            tenant_id: 1,
          });
          const id = target.get("id");
          let failObserver: "update" | "create" | "delete" | undefined;
          User.observe({
            updated(model: { get(key: string): unknown }) {
              if (failObserver === "update" && model.get("id") === id)
                throw new Error("injected SCIM update observer failure");
            },
            created(model: { get(key: string): unknown }) {
              if (
                failObserver === "create" &&
                model.get("email") === "rollback-created@example.test"
              )
                throw new Error("injected SCIM create observer failure");
            },
            deleted(model: { get(key: string): unknown }) {
              if (failObserver === "delete" && model.get("id") === id)
                throw new Error("injected SCIM delete observer failure");
            },
          });
          async function request(
            path: string,
            method = "GET",
            body?: unknown,
            token = "fixture-scim-two",
          ) {
            const response = await fetch(`${origin}/scim/v2/${path}`, {
              method,
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/scim+json",
              },
              body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await response.text();
            const parsed: unknown = text ? JSON.parse(text) : null;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              if (response.status === 204)
                return {
                  status: response.status,
                  body: {} as Record<string, unknown>,
                  contentType: response.headers.get("content-type"),
                };
              throw new Error("Expected SCIM object response.");
            }
            return {
              status: response.status,
              body: parsed as Record<string, unknown>,
              contentType: response.headers.get("content-type"),
            };
          }
          const patch = (Operations: unknown) => ({
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations,
          });
          expect((await request(`Users/${id}`)).status).toBe(200);
          expect((await request(`Users/${id}`, "GET", undefined, "fixture-scim-one")).status).toBe(
            404,
          );
          for (const body of [
            patch([{ op: "replace", path: "active", value: false }]),
            patch([
              { op: "replace", path: "displayName", value: "Partial" },
              { op: "replace", path: "active", value: false },
            ]),
            patch([{ op: "replace", value: { displayName: "Partial", active: false } }]),
            patch([{ op: "remove", path: "displayName" }]),
            patch([{ op: "replace", path: "unsupported", value: "ignored" }]),
            patch([{ op: "replace", value: { unsupported: "ignored" } }]),
            patch([{ op: "replace", path: "userName", value: { bad: true } }]),
            patch([
              {
                op: "replace",
                path: "emails",
                value: [{ value: "valid@example.test" }, { value: "other@example.test" }],
              },
            ]),
            patch([{ op: "replace", path: "name", value: { formatted: 123 } }]),
            patch([
              {
                op: "replace",
                path: "emails",
                value: [{ value: "valid@example.test", primary: false }],
              },
            ]),
            patch([
              {
                op: "replace",
                path: "emails",
                value: [{ value: "valid@example.test", type: "work" }],
              },
            ]),
            patch([{ op: "replace", path: 123, value: "invalid" }]),
            patch([{ path: "displayName", value: "missing operation" }]),
            patch([]),
            patch(null),
            patch([null]),
            null,
            [],
            {
              schemas: ["wrong"],
              Operations: [{ op: "replace", path: "displayName", value: "Partial" }],
            },
          ]) {
            const rejected = await request(`Users/${id}`, "PATCH", body);
            expect(rejected.status).toBe(400);
            expect(rejected.contentType).toContain("application/scim+json");
            expect(rejected.body.schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
            expect(rejected.body.status).toBe("400");
            const stored = await User.find(id);
            expect(stored.get("name")).toBe("Original");
            expect(stored.get("email")).toBe("scim-target@example.test");
            expect(stored.get("password")).toBe(password);
          }
          for (const method of ["POST", "PUT"]) {
            const rejected = await request(method === "POST" ? "Users" : `Users/${id}`, method, {
              userName: "inactive@example.test",
              displayName: "Inactive",
              active: false,
            });
            expect(rejected.status).toBe(400);
            expect(await User.where({ email: "inactive@example.test" }).count()).toBe(0);
          }

          failObserver = "update";
          try {
            for (const method of ["PATCH", "PUT"]) {
              const body =
                method === "PATCH"
                  ? patch([{ op: "replace", path: "displayName", value: "Must roll back" }])
                  : { userName: "rollback-updated@example.test", displayName: "Must roll back" };
              expect((await request(`Users/${id}`, method, body)).status).toBe(500);
              const unchanged = await User.find(id);
              expect(unchanged.get("name")).toBe("Original");
              expect(unchanged.get("email")).toBe("scim-target@example.test");
            }
          } finally {
            failObserver = undefined;
          }
          failObserver = "create";
          try {
            expect(
              (
                await request("Users", "POST", {
                  userName: "rollback-created@example.test",
                  displayName: "Must roll back",
                })
              ).status,
            ).toBe(500);
            expect(await User.where({ email: "rollback-created@example.test" }).count()).toBe(0);
          } finally {
            failObserver = undefined;
          }
          failObserver = "delete";
          try {
            expect((await request(`Users/${id}`, "DELETE")).status).toBe(500);
            expect(await User.find(id)).not.toBeNull();
          } finally {
            failObserver = undefined;
          }
          const changed = await request(
            `Users/${id}`,
            "PATCH",
            patch([
              { op: "replace", path: "displayName", value: "Changed" },
              {
                op: "add",
                path: "emails",
                value: [{ value: "UPDATED@example.test", primary: true }],
              },
            ]),
          );
          expect(changed.status).toBe(200);
          expect(changed.body.userName).toBe("updated@example.test");
          expect(changed.body.name).toEqual({ formatted: "Changed" });
          const objectPatch = await request(
            `Users/${id}`,
            "PATCH",
            patch([
              {
                op: "replace",
                value: {
                  name: { givenName: "New", familyName: "Name" },
                  userName: "final@example.test",
                  active: true,
                },
              },
            ]),
          );
          expect(objectPatch.status).toBe(200);
          expect(objectPatch.body.name).toEqual({ formatted: "New Name" });
          const created = await request("Users", "POST", {
            userName: "created@example.test",
            name: { formatted: "Created" },
            active: true,
          });
          expect(created.status).toBe(201);
          expect((await User.find(Number(created.body.id))).get("tenant_id")).toBe(2);
          const replaced = await request(`Users/${id}`, "PUT", {
            userName: "replaced@example.test",
            displayName: "Replaced",
            active: true,
          });
          expect(replaced.status).toBe(200);
          expect(replaced.body.name).toEqual({ formatted: "Replaced" });
          const untouched = await User.find(neighbor.get("id"));
          expect(untouched.get("name")).toBe("Neighbor");
          expect(untouched.get("password")).toBe(password);
          expect((await request(`Users/${id}`, "DELETE")).status).toBe(204);
          expect((await request(`Users/${id}`)).status).toBe(404);
        } finally {
          server.stop(true);
          await boot.context.dispose();
          await closeDatabase();
        }
        process.chdir(repoRoot);
      }
    },
  );

  appTest(
    "generated JSON and HTML email verification keeps links retryable across failures and applies once",
    async () => {
      const root = await tempDir();
      const app = generateFromArgs(root, [
        "verify-runtime",
        "--frontend=hybrid",
        "--database=sqlite",
        "--auth=cookie-token-jwt",
        "--email-verification",
        "--yes",
      ]);
      const packagePath = join(app, "package.json");
      const pkg = JSON.parse(await readFile(packagePath, "utf8"));
      for (const name of ["core", "bootstrap", "cli"])
        pkg.dependencies[`@getstrata/${name}`] =
          `file:${join(repoRoot, `packages/strata-${name}`)}`;
      await writeFile(packagePath, JSON.stringify(pkg));
      installGeneratedAppDependencies(app);
      process.chdir(app);
      Object.assign(process.env, {
        DATABASE_URL: "sqlite:./storage/app.sqlite",
        APP_ENV: "local",
        FRONTEND_MODE: "hybrid",
        TENANCY_DRIVER: "none",
        AUTH_DEV_HEADERS: "false",
        SESSION_SECRET: "dev-verification-secret-at-least-32-characters",
        MAIL_DRIVER: "log",
        CACHE_DRIVER: "array",
        QUEUE_DRIVER: "sync",
      });
      resetDiscoverModulesForTests();
      const { bootstrapApp, createAppServer } = await import(
        join(app, "src/bootstrap/createApp.ts")
      );
      const { getSql, closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      const { User } = await import(join(app, "src/models/User.ts"));
      const { AuthOneTimeToken } = await import(join(app, "src/models/AuthOneTimeToken.ts"));
      const { generateOneTimeToken, AUTH_ONE_TIME_PURPOSES } = await import(
        "@getstrata/core/auth/oneTimeToken"
      );
      const { absoluteTemporarySignedUrl } = await import("@getstrata/core/http/signedUrl");
      const { hashPassword } = await import("@getstrata/core/auth/password");
      const boot = await bootstrapApp();
      const server = createAppServer(boot.routes, 0),
        origin = `http://127.0.0.1:${server.port}`;
      process.env.APP_URL = origin;
      let observerFailureId: number | undefined;
      User.observe({
        updated(model: { get(key: string): unknown }) {
          if (Number(model.get("id")) === observerFailureId)
            throw new Error("injected verification observer failure");
        },
      });
      try {
        await getSql().unsafe(
          "CREATE TABLE verification_effect_count(user_id INTEGER PRIMARY KEY, writes INTEGER NOT NULL)",
        );
        await getSql().unsafe(
          "CREATE TRIGGER count_verification AFTER UPDATE OF email_verified_at ON users BEGIN INSERT INTO verification_effect_count VALUES(NEW.id,1) ON CONFLICT(user_id) DO UPDATE SET writes=writes+1; END",
        );
        const password = await hashPassword("Initial!Password123");
        const neighbor = await User.create({
          name: "Neighbor",
          email: "verification-neighbor@example.test",
          password,
          is_admin: false,
        });
        const csrf = await jsonCsrfHeaders(origin);
        for (const html of [false, true]) {
          const path = html ? "/email/verify" : "/api/v1/auth/verify-email";
          const user = await User.create({
            name: "Verification fixture",
            email: `verify-${html}@example.test`,
            password,
            is_admin: false,
          });
          const id = Number(user.get("id"));
          const issue = async (purpose: string, expires = Date.now() + 60000) => {
            const issued = generateOneTimeToken();
            const row = await AuthOneTimeToken.create({
              purpose,
              user_id: id,
              token_hash: issued.hash,
              expires_at: new Date(expires).toISOString(),
            });
            const link = absoluteTemporarySignedUrl(path, 60, {
              token: issued.plain,
              id: String(id),
            });
            return { row, link };
          };
          const submit = (link: string, withCsrf = true) =>
            fetch(link, {
              method: html ? "GET" : "POST",
              redirect: "manual",
              headers: withCsrf ? csrf.headers : { origin, "content-type": "application/json" },
              body: html ? undefined : "{}",
            });
          const consumed = async (row: { get(key: string): unknown }) =>
            (await AuthOneTimeToken.find(row.get("id"))).get("consumed_at");
          const valid = await issue(AUTH_ONE_TIME_PURPOSES.emailVerify);
          expect((await submit(`${valid.link}&tampered=true`)).status).toBe(403);
          expect(await consumed(valid.row)).toBeNull();
          if (!html) {
            expect((await submit(valid.link, false)).status).toBe(403);
            expect(await consumed(valid.row)).toBeNull();
          }
          const wrong = await issue(AUTH_ONE_TIME_PURPOSES.passwordReset);
          expect((await submit(wrong.link)).status).toBe(html ? 302 : 403);
          expect(await consumed(wrong.row)).toBeNull();
          const expired = await issue(AUTH_ONE_TIME_PURPOSES.emailVerify, Date.now() - 1000);
          expect((await submit(expired.link)).status).toBe(html ? 302 : 403);
          expect(await consumed(expired.row)).toBeNull();
          expect((await User.find(id)).get("email_verified_at")).toBeNull();
          await getSql().unsafe(
            `CREATE TRIGGER reject_verification BEFORE UPDATE ON users WHEN OLD.id=${id} BEGIN SELECT RAISE(ABORT,'injected verification failure'); END`,
          );
          try {
            expect((await submit(valid.link)).status).toBe(400);
          } finally {
            await getSql().unsafe("DROP TRIGGER reject_verification");
          }
          expect(await consumed(valid.row)).toBeNull();
          expect((await User.find(id)).get("email_verified_at")).toBeNull();
          observerFailureId = id;
          try {
            expect((await submit(valid.link)).status).toBe(500);
          } finally {
            observerFailureId = undefined;
          }
          expect(await consumed(valid.row)).toBeNull();
          expect((await User.find(id)).get("email_verified_at")).toBeNull();
          expect(
            await getSql().unsafe("SELECT * FROM verification_effect_count WHERE user_id=?", [id]),
          ).toHaveLength(0);
          const success = await submit(valid.link);
          expect(success.status).toBe(html ? 302 : 200);
          expect(await consumed(valid.row)).not.toBeNull();
          const verified = (await User.find(id)).get("email_verified_at");
          expect(verified).not.toBeNull();
          expect((await submit(valid.link)).status).toBe(html ? 302 : 403);
          expect((await User.find(id)).get("email_verified_at")).toBe(verified);
          expect(
            await getSql().unsafe("SELECT writes FROM verification_effect_count WHERE user_id=?", [
              id,
            ]),
          ).toEqual([{ writes: 1 }]);
          const next = await User.create({
            name: "Concurrent verification",
            email: `concurrent-${html}@example.test`,
            password,
            is_admin: false,
          });
          const nextId = Number(next.get("id"));
          const issued = generateOneTimeToken();
          await AuthOneTimeToken.create({
            purpose: AUTH_ONE_TIME_PURPOSES.emailVerify,
            user_id: nextId,
            token_hash: issued.hash,
            expires_at: new Date(Date.now() + 60000).toISOString(),
          });
          const link = absoluteTemporarySignedUrl(path, 60, {
            token: issued.plain,
            id: String(nextId),
          });
          const attempts = await Promise.all([submit(link), submit(link)]);
          expect(attempts.map((r) => r.status).sort()).toEqual(html ? [302, 302] : [200, 403]);
          expect((await User.find(nextId)).get("email_verified_at")).not.toBeNull();
          expect(
            await getSql().unsafe("SELECT writes FROM verification_effect_count WHERE user_id=?", [
              nextId,
            ]),
          ).toEqual([{ writes: 1 }]);
          expect((await User.find(neighbor.get("id"))).get("email_verified_at")).toBeNull();
          expect((await User.find(id)).get("password")).toBe(password);
        }
      } finally {
        observerFailureId = undefined;
        server.stop(true);
        await boot.context.dispose();
        await closeDatabase();
      }
    },
  );

  appTest(
    "generated JSON and HTML password resets validate before atomic consumption and revocation",
    async () => {
      const root = await tempDir();
      const app = generateFromArgs(root, [
        "reset-runtime",
        "--frontend=hybrid",
        "--database=sqlite",
        "--auth=cookie-token-jwt",
        "--yes",
      ]);
      const packagePath = join(app, "package.json");
      const pkg = JSON.parse(await readFile(packagePath, "utf8"));
      for (const name of ["core", "bootstrap", "cli"])
        pkg.dependencies[`@getstrata/${name}`] =
          `file:${join(repoRoot, `packages/strata-${name}`)}`;
      await writeFile(packagePath, JSON.stringify(pkg));
      installGeneratedAppDependencies(app);
      process.chdir(app);
      process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
      process.env.APP_ENV = "local";
      process.env.FRONTEND_MODE = "hybrid";
      process.env.TENANCY_DRIVER = "none";
      process.env.SESSION_SECRET = "dev-session-secret-change-me-please-32ch";
      process.env.AUTH_DEV_HEADERS = "false";
      process.env.MAIL_DRIVER = "log";
      process.env.CACHE_DRIVER = "array";
      process.env.QUEUE_DRIVER = "sync";
      resetDiscoverModulesForTests();
      const { bootstrapApp, createAppServer } = await import(
        join(app, "src/bootstrap/createApp.ts")
      );
      const { getSql, closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      const { User } = await import(join(app, "src/models/User.ts"));
      const { AuthOneTimeToken } = await import(join(app, "src/models/AuthOneTimeToken.ts"));
      const { generateOneTimeToken, AUTH_ONE_TIME_PURPOSES } = await import(
        "@getstrata/core/auth/oneTimeToken"
      );
      const { absoluteTemporarySignedUrl } = await import("@getstrata/core/http/signedUrl");
      const { hashPassword, verifyPassword } = await import("@getstrata/core/auth/password");
      const boot = await bootstrapApp();
      const server = createAppServer(boot.routes, 0);
      const origin = `http://127.0.0.1:${server.port}`;
      process.env.APP_URL = origin;
      try {
        for (const html of [false, true]) {
          const password = "Initial!Password123";
          const replacement = "Replacement!Password123";
          const user = await User.create({
            name: "Reset fixture",
            email: `reset-${html}@example.test`,
            password: await hashPassword(password),
            is_admin: false,
          });
          const id = Number(user.get("id"));
          const csrf = await jsonCsrfHeaders(origin);
          let cookie = csrf.cookie;
          async function post(path: string, body: object | URLSearchParams | string, raw = false) {
            const response = await fetch(new URL(path, origin), {
              method: "POST",
              redirect: "manual",
              headers: {
                ...csrf.headers,
                cookie,
                "content-type":
                  body instanceof URLSearchParams
                    ? "application/x-www-form-urlencoded"
                    : "application/json",
              },
              body: raw
                ? String(body)
                : body instanceof URLSearchParams
                  ? body
                  : JSON.stringify(body),
            });
            cookie = mergeCookies(response, cookie);
            return response;
          }
          const login = await post("/api/v1/auth/login", { email: user.get("email"), password });
          expect(login.status).toBe(200);
          const loginBody: unknown = await login.json();
          if (
            typeof loginBody !== "object" ||
            loginBody === null ||
            !("token" in loginBody) ||
            typeof loginBody.token !== "string"
          )
            throw new Error("Login token missing.");
          const token = loginBody.token;
          const jwtResponse = await post("/api/auth/token", { email: user.get("email"), password });
          expect(jwtResponse.status).toBe(200);
          const jwtBody: unknown = await jwtResponse.json();
          if (
            typeof jwtBody !== "object" ||
            jwtBody === null ||
            !("token" in jwtBody) ||
            typeof jwtBody.token !== "string"
          )
            throw new Error("JWT missing.");
          const jwt = jwtBody.token;
          const credentialStatus = (bearer?: string) =>
            fetch(`${origin}/api/user`, {
              headers: bearer ? { authorization: `Bearer ${bearer}` } : { cookie },
              redirect: "manual",
            }).then((response) => response.status);
          for (const bearer of [undefined, token, jwt])
            expect(await credentialStatus(bearer)).toBe(200);
          const issued = generateOneTimeToken();
          await AuthOneTimeToken.create({
            purpose: AUTH_ONE_TIME_PURPOSES.passwordReset,
            user_id: id,
            token_hash: issued.hash,
            expires_at: new Date(Date.now() + 60000).toISOString(),
          });
          const link = absoluteTemporarySignedUrl(
            html ? "/reset-password" : "/api/v1/auth/reset-password",
            60,
            { token: issued.plain, email: String(user.get("email")) },
          );
          const consumed = async () =>
            (await AuthOneTimeToken.query().where({ token_hash: issued.hash }).first())?.get(
              "consumed_at",
            );
          const submit = (value: string) =>
            post(
              link,
              html
                ? new URLSearchParams({
                    password: value,
                    email: String(user.get("email")),
                    _token: csrf.token,
                  })
                : { password: value },
            );
          expect((await submit("short")).status).toBe(html ? 200 : 403);
          expect(await consumed()).toBeNull();
          if (!html) {
            for (const value of [null, 123456789, {}, []]) {
              expect((await post(link, { password: value })).status).toBe(403);
              expect(await consumed()).toBeNull();
            }
            expect((await post(link, "{", true)).status).toBeGreaterThanOrEqual(400);
            expect(await consumed()).toBeNull();
          }
          for (const table of ["users", "api_tokens"]) {
            const operation = table === "users" ? "UPDATE" : "DELETE";
            await getSql().unsafe(
              `CREATE TRIGGER reject_reset BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected reset failure'); END`,
            );
            try {
              expect((await submit(replacement)).status).toBe(400);
            } finally {
              await getSql().unsafe("DROP TRIGGER reject_reset");
            }
            expect(await consumed()).toBeNull();
            expect(await verifyPassword(password, (await User.find(id)).get("password"))).toBe(
              true,
            );
            for (const bearer of [undefined, token, jwt])
              expect(await credentialStatus(bearer)).toBe(200);
          }
          expect((await submit(replacement)).status).toBe(html ? 302 : 200);
          expect(await consumed()).not.toBeNull();
          expect(await verifyPassword(replacement, (await User.find(id)).get("password"))).toBe(
            true,
          );
          for (const bearer of [undefined, token, jwt])
            expect(await credentialStatus(bearer)).toBe(401);
          expect((await submit("Another!Password123")).status).toBe(html ? 200 : 403);
          expect(await verifyPassword(replacement, (await User.find(id)).get("password"))).toBe(
            true,
          );
        }
      } finally {
        server.stop(true);
        await boot.context.dispose();
        await closeDatabase();
      }
    },
  );

  appTest("cookie sqlite HTML app serves welcome, login, register, and signs in", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "cookie-app",
      "--oidc",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie",
      "--yes",
    ]);

    const repo = repoRoot;
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies["@getstrata/core"] = `file:${join(repo, "packages/strata-core")}`;
    pkg.dependencies["@getstrata/bootstrap"] = `file:${join(repo, "packages/strata-bootstrap")}`;
    pkg.dependencies["@getstrata/cli"] = `file:${join(repo, "packages/strata-cli")}`;
    await Bun.write(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    installGeneratedAppDependencies(app);

    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.TENANCY_DRIVER = "none";
    process.env.SESSION_SECRET = "dev-session-secret-change-me-please-32ch";
    process.env.AUTH_DEV_HEADERS = "false";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";

    function cookieHeader(response: Response, previous = ""): string {
      const jar = new Map<string, string>();
      for (const part of previous
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)) {
        const [name, ...rest] = part.split("=");
        if (name) {
          jar.set(name, rest.join("="));
        }
      }
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";")[0] ?? "";
        const [name, ...rest] = pair.split("=");
        if (name) {
          jar.set(name, rest.join("="));
        }
      }
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    try {
      const { bootstrapApp, createAppServer } = await import(
        `${join(app, "src/bootstrap/createApp.ts")}`
      );
      const { closeDatabase } = await import(`${join(app, "src/bootstrap/database.ts")}`);
      const { routes } = await bootstrapApp();
      const { getSql } = await import(join(app, "src/bootstrap/database.ts"));
      const { seed } = await import(join(app, "src/db/migrate.ts"));
      expect(await getSql().unsafe("SELECT COUNT(*) AS count FROM users")).toEqual([{ count: 0 }]);
      const previousAppEnv = process.env.APP_ENV;
      try {
        for (const appEnv of ["production", "staging"]) {
          process.env.APP_ENV = appEnv;
          await expect(seed()).rejects.toThrow(
            "Demo seeding is disabled in production and staging.",
          );
        }
      } finally {
        if (previousAppEnv === undefined) delete process.env.APP_ENV;
        else process.env.APP_ENV = previousAppEnv;
      }
      expect(await getSql().unsafe("SELECT COUNT(*) AS count FROM users")).toEqual([{ count: 0 }]);
      await (await import(join(app, "src/db/migrate.ts"))).seed();
      const server = createAppServer(routes, 0);
      const origin = `http://127.0.0.1:${server.port}`;
      try {
        const home = await fetch(`${origin}/`);
        const login = await fetch(`${origin}/login`);
        const register = await fetch(`${origin}/register`);
        const forgot = await fetch(`${origin}/forgot-password`);
        const health = await fetch(`${origin}/health`);
        const loginHtml = await login.text();
        expect(home.status).toBe(200);
        const homeHtml = await home.text();
        expect(homeHtml).toContain("Welcome to cookie-app");
        expect(homeHtml).toContain('<div id="page-content">');
        expect(homeHtml).toContain('hx-target="#page-content"');
        const representations: Record<string, string>[] = [
          { "HX-Request": "true" },
          { "HX-Request": "true", "HX-Boosted": "true" },
          { "HX-Request": "true", "HX-History-Restore-Request": "true" },
        ];
        for (const headers of representations) {
          const response = await fetch(`${origin}/`, { headers });
          const html = await response.text();
          expect(response.status).toBe(200);
          expect(html).toContain("Welcome to cookie-app");
          expect(html.includes('<div id="page-content">')).toBe(Object.keys(headers).length > 1);
          expect(response.headers.get("vary")?.toLowerCase()).toContain(
            "hx-history-restore-request",
          );
        }
        const htmxLogin = await fetch(`${origin}/login`, { headers: { "HX-Request": "true" } });
        expect(await htmxLogin.text()).toContain('<div id="page-content">');
        expect(login.status).toBe(200);
        expect(loginHtml).toContain("Sign in");
        expect(loginHtml).toContain('name="_token"');
        expect(register.status).toBe(200);
        expect(await register.text()).toContain("Create account");
        expect(forgot.status).toBe(200);
        expect(await forgot.text()).toContain("Forgot password");
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("ok");

        process.env.OIDC_CLIENT_ID = "fixture-client";
        process.env.OIDC_CLIENT_SECRET = "fixture-secret";
        for (const flag of ["true", "1", "false"]) {
          process.env.FEATURE_OAUTH = flag;
          const page = await fetch(`${origin}/login`);
          expect((await page.text()).includes('href="/auth/oidc"')).toBe(flag === "true");
        }
        process.env.FEATURE_OAUTH = "false";

        const token = /name="_token" value="([^"]+)"/.exec(loginHtml)?.[1];
        expect(token).toBeTruthy();
        const cookies = cookieHeader(login);
        const csrfRejected = await fetch(`${origin}/login`, {
          method: "POST",
          headers: { cookie: cookies, origin },
          body: new URLSearchParams({ email: "demo@example.com", password: "incorrect" }),
        });
        expect(csrfRejected.status).toBe(403);
        const invalidLogin = await fetch(`${origin}/login`, {
          method: "POST",
          headers: { cookie: cookies, origin, "HX-Request": "true" },
          body: new URLSearchParams({
            _token: token ?? "",
            email: "demo@example.com",
            password: "incorrect",
          }),
        });
        expect(invalidLogin.status).toBe(200);
        const invalidHtml = await invalidLogin.text();
        expect(invalidHtml).toContain("These credentials do not match our records.");
        expect(invalidHtml).toContain('<div id="page-content">');
        expect(invalidHtml).toContain('name="_token"');

        const signedIn = await fetch(`${origin}/login`, {
          method: "POST",
          headers: {
            cookie: cookies,
            origin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            _token: token ?? "",
            email: "demo@example.com",
            password: "StrataDemo!ChangeMe",
          }),
          redirect: "manual",
        });
        expect(signedIn.status).toBe(302);
        expect(signedIn.headers.get("location")).toBe("/");
        const sessionCookies = cookieHeader(signedIn, cookies);
        const welcome = await fetch(`${origin}/`, { headers: { cookie: sessionCookies } });
        expect(welcome.status).toBe(200);
        expect(await welcome.text()).toContain("demo@example.com");
      } finally {
        server.stop();
        await closeDatabase();
      }
    } finally {
      process.chdir(repoRoot);
    }
  });

  appTest("token sqlite API app mints expiring tokens and rejects expired ones", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "token-app",
      "--frontend=api",
      "--database=sqlite",
      "--auth=token",
      "--yes",
    ]);

    const repo = repoRoot;
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies["@getstrata/core"] = `file:${join(repo, "packages/strata-core")}`;
    pkg.dependencies["@getstrata/bootstrap"] = `file:${join(repo, "packages/strata-bootstrap")}`;
    pkg.dependencies["@getstrata/cli"] = `file:${join(repo, "packages/strata-cli")}`;
    await Bun.write(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    installGeneratedAppDependencies(app);

    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "api";
    process.env.TENANCY_DRIVER = "none";
    process.env.AUTH_DEV_HEADERS = "false";
    process.env.FEATURE_API_TOKENS = "true";
    process.env.TOKEN_HASH_PEPPER = "dev-token-pepper-change-me";
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "30";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";

    try {
      const { bootstrapApp, createAppServer } = await import(
        `${join(app, "src/bootstrap/createApp.ts")}`
      );
      const { closeDatabase, getSql } = await import(`${join(app, "src/bootstrap/database.ts")}`);
      const { routes } = await bootstrapApp();
      await (await import(join(app, "src/db/migrate.ts"))).seed();
      const server = createAppServer(routes, 0);
      const origin = `http://127.0.0.1:${server.port}`;
      try {
        const blocked = await fetch(`${origin}/api/v1/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
        });
        expect(blocked.status).toBe(403);

        const csrf = await jsonCsrfHeaders(origin);
        const login = await fetch(`${origin}/api/v1/auth/login`, {
          method: "POST",
          headers: csrf.headers,
          body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
        });
        expect(login.status).toBe(200);
        const minted = (await login.json()) as { token: string; expires_at: string | null };
        expect(minted.token.startsWith("strp_")).toBe(true);
        expect(minted.expires_at).toBeTruthy();
        const expiresAt = new Date(minted.expires_at ?? "");
        const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(29);
        expect(days).toBeLessThanOrEqual(30);

        const stored = (await getSql().unsafe(
          "SELECT expires_at FROM api_tokens ORDER BY id DESC LIMIT 1",
        )) as Array<{ expires_at: string | null }>;
        expect(stored[0]?.expires_at).toBeTruthy();

        const me = await fetch(`${origin}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${minted.token}` },
        });
        expect(me.status).toBe(200);

        // Backdate the stored expiry: the same token must now be unauthorized.
        await getSql().unsafe(
          "UPDATE api_tokens SET expires_at = ? WHERE id = (SELECT MAX(id) FROM api_tokens)",
          [new Date(Date.now() - 60_000).toISOString()],
        );
        const expired = await fetch(`${origin}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${minted.token}` },
        });
        expect(expired.status).toBe(401);
      } finally {
        server.stop();
        await closeDatabase();
      }
    } finally {
      delete process.env.FEATURE_API_TOKENS;
      delete process.env.TOKEN_HASH_PEPPER;
      delete process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS;
      process.chdir(repoRoot);
    }
  });
});
