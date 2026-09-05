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
  parseKit,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { presetLayers } from "../../../packages/strata-starter/src/presets.ts";
import { type Prompter, promptLayers } from "../../../packages/strata-starter/src/prompt.ts";

const tempDirectories: string[] = [];
const repoRoot = process.cwd();
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

function generateInto(directory: string, name: string, kit: Parameters<typeof presetLayers>[0]) {
  generateProject({
    projectName: name,
    targetDir: join(directory, name),
    layers: presetLayers(kit),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });
  return join(directory, name);
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
  test("parses kits, aliases, and layer overrides", () => {
    expect(parseKit("hiroapp_build_from_starter_kit_x_level_entreprise")).toBe(
      "hiroapp-enterprise",
    );
    expect(parseKit("hiroapp-hobby")).toBe("hiroapp-hobby");

    const flags = parseCreateStrataArgs([
      "acme",
      "--kit=team",
      "--database=sqlite",
      "--auth=cookie-token",
      "--yes",
    ]);
    expect(flags.projectName).toBe("acme");
    expect(flags.kit).toBe("team");
    expect(flags.yes).toBe(true);

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
    const docker = parseCreateStrataArgs(["acme", "--kit=team", "--docker", "--yes"]);
    expect(docker.docker).toBe(true);
    expect(layersFromFlags(docker).docker.services.postgres).toBe(true);
    expect(layersFromFlags(docker).docker.services.redis).toBe(true);

    const local = parseCreateStrataArgs(["acme", "--kit=team", "--docker", "--no-docker", "--yes"]);
    expect(local.docker).toBe(false);
    expect(layersFromFlags(local).docker.enabled).toBe(false);

    const subset = parseCreateStrataArgs([
      "acme",
      "--kit=team",
      "--docker-services=postgres,redis",
      "--yes",
    ]);
    expect(subset.dockerServices).toEqual(["postgres", "redis"]);
    expect(layersFromFlags(subset).docker.services.postgres).toBe(true);
    expect(layersFromFlags(subset).docker.services.redis).toBe(true);

    expect(() => parseCreateStrataArgs(["acme", "--docker-services=mongo"])).toThrow(
      /Unknown docker service/,
    );
  });

  test("custom kit without layer flags is rejected by usage of layersFromFlags still producing hobby defaults", () => {
    const flags = parseCreateStrataArgs(["demo", "--kit=custom", "--frontend=hybrid", "--yes"]);
    const layers = layersFromFlags(flags);
    expect(layers.kit).toBe("custom");
    expect(layers.frontend).toBe("hybrid");
    expect(layers.database).toBe("sqlite");
  });
});

describe("create-strata generate", () => {
  test("hobby kit is sqlite headers API without docker compose", async () => {
    const root = await tempDir();
    const app = generateInto(root, "hobby-app", "hobby");

    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("FRONTEND_MODE=api");
    expect(env).toContain("sqlite:./storage/app.sqlite");
    expect(env).toContain("AUTH_DEV_HEADERS=true");
    expect(existsSync(join(app, "docker-compose.yml"))).toBe(false);
    expect(existsSync(join(app, "strata.layers.json"))).toBe(true);

    const layers = JSON.parse(await readFile(join(app, "strata.layers.json"), "utf8")) as {
      kit: string;
      hiroappEquivalent: boolean;
    };
    expect(layers.kit).toBe("hobby");
    expect(layers.hiroappEquivalent).toBe(false);

    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("Docker Compose | not needed");
    expect(readme).not.toContain("docker compose up -d");

    const database = await readFile(join(app, "src/bootstrap/database.ts"), "utf8");
    expect(database).toContain("createSqliteConnection");
    expect(database).not.toContain('from "@getstrata/core"');

    const auth = await readFile(join(app, "src/bootstrap/providers/auth.ts"), "utf8");
    expect(auth).toContain("x-authenticated-user-id");
    expect(existsSync(join(app, "src/modules/auth/index.ts"))).toBe(false);

    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@getstrata/core"]).toBe("^0.7.3");
    expect(pkg.dependencies["@getstrata/cli"]).toBe("^0.2.0");
    expect(pkg.scripts.dev).toBe("strata dev");
    expect(pkg.scripts["db:migrate"]).toBe("strata migrate");
  });

  test("enterprise kit writes hybrid overlays, cookie+jwt auth, redis compose, and sidecars", async () => {
    const root = await tempDir();
    const app = generateInto(root, "ent-app", "enterprise");

    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("FRONTEND_MODE=hybrid");
    expect(env).toContain("TENANCY_DRIVER=rls");
    expect(env).toContain("FEATURE_MFA=true");
    expect(env).toContain("FEATURE_SCIM=true");
    expect(env).toContain("KIOSK_SQLITE=");
    expect(env).toContain("MYSQL_URL=");

    expect(existsSync(join(app, "docker-compose.yml"))).toBe(true);
    const compose = await readFile(join(app, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).toContain("redis:");
    expect(compose).toContain("mysql:");
    expect(compose).toContain("mailpit:");

    expect(existsSync(join(app, "frontend/build.ts"))).toBe(true);
    expect(existsSync(join(app, "resources/views/layouts/app.eta"))).toBe(true);
    expect(existsSync(join(app, "src/bootstrap/sidecars.ts"))).toBe(true);
    expect(existsSync(join(app, "views/auth/login.eta"))).toBe(true);

    const auth = await readFile(join(app, "src/bootstrap/providers/auth.ts"), "utf8");
    expect(auth).toContain("createCookieSessionAuthManager");
    expect(auth).toContain("DatabaseTokenGuard");
    expect(auth).toContain("JwtGuard");

    const routes = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
    expect(routes).toContain("/api/v1/auth/login");
    expect(routes).toContain("/api/auth/token");
    expect(routes).toContain("/login");

    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");
    expect(createApp).toContain("mergeSpaRoutes");
    expect(createApp).toContain("assertProductionSecrets");
  });

  test("hiroapp-enterprise recipe uses /apply and careers, and is not HiroApp", async () => {
    const root = await tempDir();
    const app = generateInto(root, "hiring-ent", "hiroapp-enterprise");

    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("SPA_PREFIX=/apply");
    expect(existsSync(join(app, "src/modules/careers/index.ts"))).toBe(true);
    expect(existsSync(join(app, "views/careers.eta"))).toBe(true);

    const manifest = JSON.parse(await readFile(join(app, "strata.layers.json"), "utf8")) as {
      recipe: string;
      hiroappEquivalent: boolean;
    };
    expect(manifest.recipe).toBe("hiroapp_build_from_starter_kit_x_level_enterprise");
    expect(manifest.hiroappEquivalent).toBe(false);

    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("hiring-shaped");
    expect(readme).not.toContain("Laravel");
    expect(readme).not.toContain("WorkHub");
    expect(readme).not.toContain("—");
  });

  test("team --no-docker skips compose and documents local installs", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["team-local", "--kit=team", "--no-docker", "--yes"]);

    expect(existsSync(join(app, "docker-compose.yml"))).toBe(false);
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("off (local installs)");
    expect(readme).toContain("Use local installs for Postgres, Redis");
    expect(readme).not.toContain("docker compose up -d");
    const manifest = JSON.parse(await readFile(join(app, "strata.layers.json"), "utf8")) as {
      layers: { docker: { enabled: boolean } };
    };
    expect(manifest.layers.docker.enabled).toBe(false);
  });

  test("team --docker-services=postgres writes only postgres", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "team-pg",
      "--kit=team",
      "--docker-services=postgres",
      "--yes",
    ]);

    const compose = await readFile(join(app, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).not.toContain("redis:");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("docker compose up -d");
    expect(readme).toContain("Use local installs for Redis");
  });

  test("custom postgres --docker writes compose; without --docker it does not", async () => {
    const root = await tempDir();
    const withDocker = generateFromArgs(root, [
      "custom-pg-docker",
      "--kit=custom",
      "--database=postgres",
      "--docker",
      "--yes",
    ]);
    expect(existsSync(join(withDocker, "docker-compose.yml"))).toBe(true);
    const compose = await readFile(join(withDocker, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).not.toContain("redis:");

    const local = generateFromArgs(root, [
      "custom-pg-local",
      "--kit=custom",
      "--database=postgres",
      "--yes",
    ]);
    expect(existsSync(join(local, "docker-compose.yml"))).toBe(false);
  });

  test("refuses an existing directory", async () => {
    const root = await tempDir();
    generateInto(root, "taken", "hobby");
    expect(() => generateInto(root, "taken", "hobby")).toThrow(/already exists/);
  });
});

describe("create-strata CLI", () => {
  test("prints help", async () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "packages/strata-starter/cli.ts", "--help"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("create-strata");
    expect(out).toContain("--kit");
    expect(out).toContain("hiroapp-enterprise");
    expect(out).toContain("--docker");
    expect(out).toContain("--no-docker");
    expect(out).toContain("--docker-services");
  });

  test("scaffolds with --kit hobby --yes", async () => {
    const root = await tempDir();
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        join(process.cwd(), "packages/strata-starter/cli.ts"),
        "cli-hobby",
        "--kit",
        "hobby",
        "--yes",
      ],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("strata migrate");
    expect(out).toContain("strata dev");
    expect(out).not.toContain("bun run db:migrate");
    expect(existsSync(join(root, "cli-hobby/src/bootstrap/createApp.ts"))).toBe(true);
    expect(out).toContain("docker=none");
    expect(out).not.toContain("docker compose up -d");
  });

  test("scaffolds team with --no-docker", async () => {
    const root = await tempDir();
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        join(process.cwd(), "packages/strata-starter/cli.ts"),
        "cli-team-local",
        "--kit",
        "team",
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
    expect(out).not.toContain("docker compose up -d");
    expect(existsSync(join(root, "cli-team-local/docker-compose.yml"))).toBe(false);
  });

  test("wizard can choose local tools or a docker mix", async () => {
    const local = await promptLayers(
      parseCreateStrataArgs(["demo", "--kit=team"]),
      scriptedPrompter({
        select: ["team", "local"],
        confirm: [false, false],
      }),
    );
    expect(local.docker.enabled).toBe(false);
    expect(local.docker.services.postgres).toBe(false);
    expect(local.docker.services.redis).toBe(false);

    const mix = await promptLayers(
      parseCreateStrataArgs(["demo", "--kit=team"]),
      scriptedPrompter({
        select: ["team", "mix"],
        confirm: [false, false, true, false],
      }),
    );
    expect(mix.docker.enabled).toBe(true);
    expect(mix.docker.services.postgres).toBe(true);
    expect(mix.docker.services.redis).toBe(false);

    const hobby = await promptLayers(
      parseCreateStrataArgs(["demo"]),
      scriptedPrompter({
        select: ["hobby"],
        confirm: [false, false],
      }),
    );
    expect(hobby.docker.enabled).toBe(false);

    const flagged = await promptLayers(
      parseCreateStrataArgs(["demo", "--kit=team", "--docker-services=postgres"]),
      scriptedPrompter({
        select: ["team"],
        confirm: [false, false],
      }),
    );
    expect(flagged.docker.services.postgres).toBe(true);
    expect(flagged.docker.services.redis).toBe(false);
  });

  test("hobby sqlite app boots and answers GET /health", async () => {
    const root = await tempDir();
    const app = generateInto(root, "boot-hobby", "hobby");
    const repo = process.cwd();
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

    const originalCwd = process.cwd();
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
      process.chdir(originalCwd);
    }
  });

  test("cookie sqlite HTML kit serves /login", async () => {
    const root = await tempDir();
    const flags = parseCreateStrataArgs([
      "cookie-app",
      "--kit=custom",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie",
      "--yes",
    ]);
    const app = join(root, "cookie-app");
    generateProject({
      projectName: "cookie-app",
      targetDir: app,
      layers: layersFromFlags(flags),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });

    const repo = process.cwd();
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

    const originalCwd = process.cwd();
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
      process.chdir(originalCwd);
    }
  });

  test("custom kit without layers fails non-interactively", async () => {
    const root = await tempDir();
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        join(process.cwd(), "packages/strata-starter/cli.ts"),
        "nope",
        "--kit",
        "custom",
        "--yes",
      ],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("custom kit requires layer flags");
  });
});
