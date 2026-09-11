import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { repoRoot } from "./helpers";

const tempDirectories: string[] = [];
const ENV_KEYS = [
  "DATABASE_URL",
  "APP_ENV",
  "FRONTEND_MODE",
  "AUTH_DEV_HEADERS",
  "TENANCY_DRIVER",
  "SESSION_SECRET",
  "SPA_PREFIX",
  "CACHE_DRIVER",
  "QUEUE_DRIVER",
  "MAIL_DRIVER",
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
    expect(layersFromFlags(docker).docker.services.adminer).toBe(true);

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

    const authProvider = await readFile(join(app, "src/bootstrap/providers/auth.ts"), "utf8");
    expect(authProvider).toContain("envFlagEnabled(process.env.AUTH_DEV_HEADERS)");
    expect(authProvider).not.toContain('AUTH_DEV_HEADERS === "false"');

    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).not.toContain("createMetricsRoutes");
    expect(createApp).toContain("isProductionEnv()");
    expect(readme).not.toContain("GET /metrics");

    const database = await readFile(join(app, "src/bootstrap/database.ts"), "utf8");
    expect(database).toContain("createSqliteConnection");
    expect(database).not.toContain('from "@getstrata/core"');

    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@getstrata/core"]).toBe("^1.0.8");
    expect(pkg.dependencies.eta).toBe("^4.6.0");
    expect(pkg.dependencies.mysql2).toBeUndefined();
    expect(pkg.scripts.dev).toBe("strata dev");

    expect(readme).toContain("Strata app generated by `create-strata`.");
    expect(readme).not.toContain("dogfood");
    expect(readme).not.toContain("end-to-end");
    expect(readme).not.toContain("apps/hiroapp");

    expect(existsSync(join(app, "src/models/Note.ts"))).toBe(true);
    const note = await readFile(join(app, "src/models/Note.ts"), "utf8");
    expect(note).toContain("registerModelRepository");
    expect(note).toContain('static $fillable = ["body"]');
    expect(note).not.toContain('from "@getstrata/core"');

    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(migrate).toContain('Note.query().value("id")');
    expect(migrate).toContain('Note.create({ body: "Welcome to Strata!" })');
    expect(migrate).not.toContain("INSERT INTO notes");

    const site = await readFile(join(app, "src/modules/site/index.ts"), "utf8");
    expect(site).toContain('Note.query().value("id")');
    expect(site).not.toContain("SELECT 1 FROM notes");

    const api = await readFile(join(app, "docs/API.md"), "utf8");
    expect(api).toContain('.pluck("body", "id")');
    expect(api).not.toContain("SELECT id, body FROM notes");
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

  test("postgres HTML with docker writes postgres, redis, mailpit, and adminer", async () => {
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
    expect(compose).toContain("adminer:");
    expect(compose).toContain("ADMINER_DEFAULT_SERVER: postgres");
    expect(compose).not.toContain("mysql:");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("http://localhost:8080");

    expect(existsSync(join(app, "views/auth/login.eta"))).toBe(true);
    expect(existsSync(join(app, "views/auth/register.eta"))).toBe(true);
    expect(existsSync(join(app, "views/auth/forgot-password.eta"))).toBe(true);
    const css = await readFile(join(app, "public/assets/site.css"), "utf8");
    expect(css).toContain("--accent");
    expect(existsSync(join(app, "src/modules/careers"))).toBe(false);
    expect(existsSync(join(app, "resources/views/organizations"))).toBe(false);
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).not.toContain("MYSQL_URL");

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
  });

  test("example app maps are sqlite API, postgres HTML, and postgres HTMX enterprise", () => {
    expect(exampleAppLayers("hiroapp-hobby").database).toBe("sqlite");
    expect(exampleAppLayers("hiroapp-team").frontend).toBe("server-htmx");
    expect(exampleAppLayers("hiroapp").frontend).toBe("server-htmx");
    expect(exampleAppLayers("hiroapp").database).toBe("postgres");
    expect(exampleAppLayers("hiroapp").tenancy).toBe("rls");
    expect(exampleAppLayers("hiroapp").docker.services.mysql).toBe(false);
    expect(exampleAppLayers("hiroapp-hobby").docker.services.adminer).toBe(false);
    expect(exampleAppLayers("hiroapp-team").docker.services.adminer).toBe(true);
    expect(exampleAppLayers("hiroapp").docker.services.adminer).toBe(true);
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
    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(migrate).toContain("CREATE TABLE IF NOT EXISTS tenant");
    expect(migrate).toContain("tenant_id");
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
    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(migrate).toContain("CREATE TABLE IF NOT EXISTS tenant");
    expect(existsSync(join(app, "src/bootstrap/ensureDatabase.ts"))).toBe(true);
    const ensure = await readFile(join(app, "src/bootstrap/ensureDatabase.ts"), "utf8");
    // The database name must come from DATABASE_URL, never a hardcoded rename.
    expect(ensure).toContain("resolveAppDatabaseUrl");
    expect(ensure).not.toContain("acme_test");
    expect(ensure).not.toMatch(/url\.pathname\s*=/);
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("/acme");
    expect(env).not.toContain("acme_test");
    expect(env).not.toContain("MYSQL_URL");
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
    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(migrate).toContain("mfa_secret");
    expect(migrate).toContain("mfa_enabled");
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
    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).not.toContain("createMetricsRoutes");
  });

  test("metrics extra writes GET /metrics and a token", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["metrics-app", "--metrics", "--yes"]);
    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).toContain("createMetricsRoutes");
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
    expect(extraValues).toEqual(["metrics"]);
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
        onMultiSelect: (_message, values) => {
          extraValues = values;
        },
      }),
    );
    expect(extraValues).toEqual([]);
    expect(layers.extras.metrics).toBe(false);

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
    expect(extraValues).toEqual(["mfa", "emailVerification", "scim"]);
    expect(cookie.extras.metrics).toBe(false);

    const allFlagged = await promptLayers(
      parseCreateStrataArgs(["demo", "--mfa", "--email-verification", "--scim", "--metrics"]),
      scriptedPrompter({
        select: ["api", "sqlite", "cookie", "none", "array", "sync", "log"],
      }),
    );
    expect(allFlagged.extras).toEqual({
      mfa: true,
      emailVerification: true,
      scim: true,
      metrics: true,
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
    expect(extraValues).toEqual(["emailVerification", "scim", "metrics"]);
  });

  test("sqlite API app boots and answers GET /health", async () => {
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

    const install = Bun.spawnSync({
      cmd: ["bun", "install"],
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "api";
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.TENANCY_DRIVER = "none";

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
        expect(await ready.json()).toMatchObject({ status: "ready", checks: { database: "ok" } });
      } finally {
        coldServer.stop();
      }

      const { routes } = await bootstrapApp();
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

  test("cookie sqlite HTML app serves welcome, login, register, and signs in", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "cookie-app",
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
    const install = Bun.spawnSync({
      cmd: ["bun", "install"],
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.TENANCY_DRIVER = "none";
    process.env.SESSION_SECRET = "dev-session-secret-change-me-please-32ch";
    process.env.AUTH_DEV_HEADERS = "false";
    process.env.MAIL_DRIVER = "log";

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
        expect(await home.text()).toContain("Welcome to cookie-app");
        expect(login.status).toBe(200);
        expect(loginHtml).toContain("Sign in");
        expect(loginHtml).toContain('name="_token"');
        expect(register.status).toBe(200);
        expect(await register.text()).toContain("Create account");
        expect(forgot.status).toBe(200);
        expect(await forgot.text()).toContain("Forgot password");
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("ok");

        const token = /name="_token" value="([^"]+)"/.exec(loginHtml)?.[1];
        expect(token).toBeTruthy();
        const cookies = cookieHeader(login);
        const signedIn = await fetch(`${origin}/login`, {
          method: "POST",
          headers: {
            cookie: cookies,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            _token: token ?? "",
            email: "demo@example.com",
            password: "password",
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

  test("token sqlite API app mints expiring tokens and rejects expired ones", async () => {
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
    const install = Bun.spawnSync({
      cmd: ["bun", "install"],
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "api";
    process.env.TENANCY_DRIVER = "none";
    process.env.AUTH_DEV_HEADERS = "false";
    process.env.FEATURE_API_TOKENS = "true";
    process.env.TOKEN_HASH_PEPPER = "dev-token-pepper-change-me";
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "30";

    try {
      const { bootstrapApp, createAppServer } = await import(
        `${join(app, "src/bootstrap/createApp.ts")}`
      );
      const { closeDatabase, getSql } = await import(`${join(app, "src/bootstrap/database.ts")}`);
      const { routes } = await bootstrapApp();
      const server = createAppServer(routes, 0);
      const origin = `http://127.0.0.1:${server.port}`;
      try {
        const login = await fetch(`${origin}/api/v1/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "demo@example.com", password: "password" }),
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
