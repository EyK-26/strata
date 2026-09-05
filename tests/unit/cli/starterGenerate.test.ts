import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const tempDirectories: string[] = [];

afterEach(async () => {
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
