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
}): Prompter {
  const select = [...(script.select ?? [])];
  const confirm = [...(script.confirm ?? [])];
  const question = [...(script.question ?? [])];
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

    const database = await readFile(join(app, "src/bootstrap/database.ts"), "utf8");
    expect(database).toContain("createSqliteConnection");
    expect(database).not.toContain('from "@getstrata/core"');

    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@getstrata/core"]).toBe("^0.7.4");
    expect(pkg.scripts.dev).toBe("strata dev");
  });

  test("postgres HTML with docker writes postgres and redis only", async () => {
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
    expect(compose).not.toContain("mysql:");

    expect(existsSync(join(app, "views/auth/login.eta"))).toBe(true);
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
  });

  test("example app maps are sqlite API, postgres HTML, and postgres HTMX enterprise", () => {
    expect(exampleAppLayers("hiroapp-hobby").database).toBe("sqlite");
    expect(exampleAppLayers("hiroapp-team").frontend).toBe("server-htmx");
    expect(exampleAppLayers("hiroapp").frontend).toBe("server-htmx");
    expect(exampleAppLayers("hiroapp").database).toBe("postgres");
    expect(exampleAppLayers("hiroapp").tenancy).toBe("rls");
    expect(exampleAppLayers("hiroapp").docker.services.mysql).toBe(false);
    expect(defaultLayers().database).toBe("sqlite");
  });

  test("sqlite ignores --tenancy=rls because RLS is Postgres-only", () => {
    const layers = layersFromFlags(
      parseCreateStrataArgs(["demo", "--database=sqlite", "--tenancy=rls", "--yes"]),
    );
    expect(layers.tenancy).toBe("none");
  });

  test("postgres rls writes a tenant table and isolates the database name", async () => {
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
    expect(ensure).toContain("acme_test");
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("acme_test");
    expect(env).not.toContain("MYSQL_URL");
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
    expect(out).toContain("strata migrate");
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
        select: ["api", "sqlite", "headers", "array", "sync", "log"],
        confirm: [false],
      }),
    );
    expect(layers.frontend).toBe("api");
    expect(layers.database).toBe("sqlite");
    expect(layers.docker.enabled).toBe(false);
  });

  test("wizard can choose local tools or a docker mix", async () => {
    const local = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["server-htmx", "postgres", "cookie", "none", "redis", "redis", "log", "local"],
        confirm: [false],
      }),
    );
    expect(local.docker.enabled).toBe(false);

    const mix = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["server-htmx", "postgres", "cookie", "none", "redis", "redis", "log", "mix"],
        confirm: [false, true, false],
      }),
    );
    expect(mix.docker.services.postgres).toBe(true);
    expect(mix.docker.services.redis).toBe(false);
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

  test("cookie sqlite HTML app serves /login", async () => {
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

    try {
      const { bootstrapApp, createAppServer } = await import(
        `${join(app, "src/bootstrap/createApp.ts")}`
      );
      const { closeDatabase } = await import(`${join(app, "src/bootstrap/database.ts")}`);
      const { routes } = await bootstrapApp();
      const server = createAppServer(routes, 0);
      try {
        const login = await fetch(`http://127.0.0.1:${server.port}/login`);
        const health = await fetch(`http://127.0.0.1:${server.port}/health`);
        const html = await login.text();
        expect(login.status).toBe(200);
        expect(html).toContain("Sign in");
        expect(html).toContain('name="_token"');
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("ok");
      } finally {
        server.stop();
        await closeDatabase();
      }
    } finally {
      process.chdir(repoRoot);
    }
  });
});
