import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveProjectTarget,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";

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
  const directory = await mkdtemp(join(tmpdir(), "strata-portability-"));
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

describe("resolveProjectTarget", () => {
  test("accepts a bare project name relative to the cwd", () => {
    expect(resolveProjectTarget("my-app", "/work")).toEqual({
      projectName: "my-app",
      targetDir: "/work/my-app",
    });
  });

  test("accepts an absolute directory path and uses the basename as the project name", () => {
    expect(resolveProjectTarget("/tmp/nested/deep-app", "/work")).toEqual({
      projectName: "deep-app",
      targetDir: "/tmp/nested/deep-app",
    });
  });

  test("accepts a relative directory path", () => {
    expect(resolveProjectTarget("./sub/dir-app", "/work")).toEqual({
      projectName: "dir-app",
      targetDir: "/work/sub/dir-app",
    });
  });

  test("still rejects an unusable basename", () => {
    expect(() => resolveProjectTarget("/tmp/bad name!", "/work")).toThrow(
      /letters, numbers, hyphens, and underscores/,
    );
  });
});

describe("MySQL portability", () => {
  test("keyed string columns are bounded so MySQL can index them", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "myapp",
      "--frontend=server-htmx",
      "--database=mysql",
      "--auth=cookie-token",
      "--tenancy=column",
      "--yes",
    ]);
    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");

    // MySQL errno 1170: a TEXT column cannot appear in a key specification.
    expect(migrate).not.toMatch(/TEXT[^,\n]*\bUNIQUE\b/);
    expect(migrate).not.toMatch(/TEXT\s+PRIMARY KEY/);
    // MySQL ER_BLOB_CANT_HAVE_DEFAULT: a TEXT column cannot have a default.
    expect(migrate).not.toMatch(/TEXT[^,\n]*\bDEFAULT\b/);

    expect(migrate).toContain("email VARCHAR(255) NOT NULL UNIQUE");
    expect(migrate).toContain("id VARCHAR(255) PRIMARY KEY");
    expect(migrate).toContain("token_hash VARCHAR(255) NOT NULL UNIQUE");
    expect(migrate).toContain("slug VARCHAR(255) NOT NULL UNIQUE");
  });

  test("postgres and sqlite keep unbounded TEXT for the same columns", async () => {
    const root = await tempDir();
    for (const database of ["postgres", "sqlite"]) {
      const app = generateFromArgs(root, [
        `pg-${database}`,
        "--frontend=server-htmx",
        `--database=${database}`,
        "--auth=cookie-token",
        "--yes",
      ]);
      const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
      expect(migrate).toContain("email TEXT NOT NULL UNIQUE");
      expect(migrate).not.toContain("VARCHAR(255)");
    }
  });

  test("mysql ensureAppDatabase creates the database it was pointed at", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["myapp2", "--database=mysql", "--yes"]);
    const ensure = await readFile(join(app, "src/bootstrap/ensureDatabase.ts"), "utf8");

    expect(ensure).toContain("CREATE DATABASE IF NOT EXISTS");
    expect(ensure).toContain('from "mysql2/promise"');
    expect(ensure).toContain("connection.end()");
    expect(ensure).toContain("safeDatabaseName");

    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.eta).toBe("^4.6.0");
    expect(pkg.dependencies.mysql2).toBe("^3.24.3");
  });

  test("timestamp parameters use a format MySQL DATETIME accepts", async () => {
    const root = await tempDir();
    const mysqlApp = generateFromArgs(root, [
      "mytime",
      "--frontend=server-htmx",
      "--database=mysql",
      "--auth=cookie",
      "--email-verification",
      "--yes",
    ]);
    const mysqlAuth = await readFile(join(mysqlApp, "src/modules/auth/index.ts"), "utf8");
    expect(mysqlAuth).toContain('.slice(0, 19).replace("T", " ")');

    const pgApp = generateFromArgs(root, [
      "pgtime",
      "--frontend=server-htmx",
      "--database=postgres",
      "--auth=cookie",
      "--email-verification",
      "--yes",
    ]);
    const pgAuth = await readFile(join(pgApp, "src/modules/auth/index.ts"), "utf8");
    expect(pgAuth).toContain("new Date().toISOString()");
    expect(pgAuth).not.toContain('.slice(0, 19).replace("T", " ")');
  });

  test("migrate and fresh export close() so pooled drivers release the process", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["myclose", "--database=mysql", "--yes"]);

    const migrate = await readFile(join(app, "src/db/migrate.ts"), "utf8");
    expect(migrate).toContain("export async function close()");
    expect(migrate).toContain("closeDatabase()");

    const fresh = await readFile(join(app, "src/db/fresh.ts"), "utf8");
    expect(fresh).toContain("export async function close()");
  });
});

describe("database name resolution", () => {
  test("no layer combination renames the database to a _test suffix", async () => {
    const root = await tempDir();
    for (const database of ["postgres", "mysql"]) {
      const app = generateFromArgs(root, [`acme-${database}`, `--database=${database}`, "--yes"]);
      const ensure = await readFile(join(app, "src/bootstrap/ensureDatabase.ts"), "utf8");
      const env = await readFile(join(app, ".env.example"), "utf8");

      expect(ensure).not.toContain("_test");
      expect(env).not.toContain("_test");
      expect(env).toContain(`/acme_${database}`);
    }
  });

  test("APP_DATABASE_URL stays the documented override", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["ovr", "--database=postgres", "--yes"]);
    const ensure = await readFile(join(app, "src/bootstrap/ensureDatabase.ts"), "utf8");
    expect(ensure).toContain("APP_DATABASE_URL");
    expect(ensure).toContain("DATABASE_URL");

    // The override is discoverable from the app itself, not only from source.
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("# APP_DATABASE_URL=");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("## Database");
    expect(readme).toContain("APP_DATABASE_URL");
  });

  test("sqlite apps do not mention APP_DATABASE_URL", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["lite", "--database=sqlite", "--yes"]);
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).not.toContain("APP_DATABASE_URL");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).not.toContain("APP_DATABASE_URL");
  });
});

describe("tenancy rls coercion is visible", () => {
  test("sqlite and mysql print why rls became column", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const sqlite = layersFromFlags(
        parseCreateStrataArgs(["demo", "--database=sqlite", "--tenancy=rls", "--yes"]),
      );
      expect(sqlite.tenancy).toBe("column");
      const mysql = layersFromFlags(
        parseCreateStrataArgs(["demo", "--database=mysql", "--tenancy=rls", "--yes"]),
      );
      expect(mysql.tenancy).toBe("column");

      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.filter((m) => m.includes("Using --tenancy column"))).toHaveLength(2);
      expect(messages.some((m) => m.includes("sqlite has no equivalent"))).toBe(true);
      expect(messages.some((m) => m.includes("mysql has no equivalent"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test("postgres keeps rls without a notice", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const layers = layersFromFlags(
        parseCreateStrataArgs(["demo", "--database=postgres", "--tenancy=rls", "--yes"]),
      );
      expect(layers.tenancy).toBe("rls");
      expect(warn.mock.calls.some((call) => String(call[0]).includes("tenancy"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("extras flags match the wizard", () => {
  test("header auth drops MFA, email verification, and SCIM flags", () => {
    const layers = layersFromFlags(
      parseCreateStrataArgs([
        "app",
        "--auth=headers",
        "--mfa",
        "--scim",
        "--email-verification",
        "--metrics",
        "--yes",
      ]),
    );

    expect(layers.extras.mfa).toBe(false);
    expect(layers.extras.scim).toBe(false);
    expect(layers.extras.emailVerification).toBe(false);
    // metrics applies to every auth stack.
    expect(layers.extras.metrics).toBe(true);
  });

  test("header auth env does not advertise features it has no code for", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["hdr", "--auth=headers", "--mfa", "--scim", "--yes"]);
    const env = await readFile(join(app, ".env.example"), "utf8");

    expect(env).toContain("FEATURE_MFA=false");
    expect(env).not.toContain("FEATURE_SCIM=true");
    expect(existsSync(join(app, "src/modules/scim/index.ts"))).toBe(false);
    expect(existsSync(join(app, "src/bootstrap/pendingMfa.ts"))).toBe(false);
  });

  test("token auth keeps SCIM but still drops MFA", () => {
    const layers = layersFromFlags(
      parseCreateStrataArgs(["app", "--auth=token", "--mfa", "--scim", "--yes"]),
    );

    expect(layers.extras.mfa).toBe(false);
    expect(layers.extras.scim).toBe(true);
  });

  test("cookie auth keeps every extra", () => {
    const layers = layersFromFlags(
      parseCreateStrataArgs([
        "app",
        "--frontend=server-htmx",
        "--auth=cookie",
        "--mfa",
        "--scim",
        "--email-verification",
        "--yes",
      ]),
    );

    expect(layers.extras.mfa).toBe(true);
    expect(layers.extras.scim).toBe(true);
    expect(layers.extras.emailVerification).toBe(true);
  });
});

describe("frontend build wiring", () => {
  test("spa-react and hybrid get the frontend:build script the 503 names", async () => {
    const root = await tempDir();
    for (const frontend of ["spa-react", "hybrid"]) {
      const app = generateFromArgs(root, [`fe-${frontend}`, `--frontend=${frontend}`, "--yes"]);
      const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };

      expect(manifest.scripts["frontend:build"]).toBe("cd frontend && bun run build");
      expect(manifest.scripts["frontend:install"]).toBe("cd frontend && bun install");
      expect(await readFile(join(app, "README.md"), "utf8")).toContain("bun run frontend:build");
    }
  });

  test("api and server-htmx apps have no frontend scripts", async () => {
    const root = await tempDir();
    for (const frontend of ["api", "server-htmx"]) {
      const app = generateFromArgs(root, [`fe2-${frontend}`, `--frontend=${frontend}`, "--yes"]);
      const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };

      expect(manifest.scripts["frontend:build"]).toBeUndefined();
    }
  });

  test("the SPA overlay only calls endpoints the generated backend serves", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["spa", "--frontend=spa-react", "--auth=token", "--yes"]);

    const pages = join(app, "frontend/src");
    for (const stale of ["OrganizationsPage.tsx", "ProjectsPage.tsx", "TasksPage.tsx"]) {
      expect(existsSync(join(pages, "pages", stale))).toBe(false);
    }

    const shell = await readFile(join(pages, "App.tsx"), "utf8");
    expect(shell).not.toContain("organizations");
    expect(shell).not.toContain("projects");
    expect(shell).not.toContain("tasks");

    const home = await readFile(join(pages, "pages/HomePage.tsx"), "utf8");
    expect(home).toContain("auth/me");
  });
});

describe("generated API docs", () => {
  test("header auth docs claim no login routes", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["docs-hdr", "--frontend=api", "--auth=headers", "--yes"]);
    const docs = await readFile(join(app, "docs/API.md"), "utf8");

    expect(docs).toContain("`GET` | `/health`");
    expect(docs).toContain("Docker HEALTHCHECK uses this path");
    // /ready is served by createHealthRoutes() in every generated app; document what it checks.
    expect(docs).toContain("`GET` | `/ready`");
    expect(docs).toContain("does not check the schema");
    expect(docs).not.toContain("/api/v1/auth/login");
    expect(docs).not.toContain("actingAs");
    expect(docs).not.toContain("postJson");
  });

  test("token auth docs list the login routes that exist", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["docs-tok", "--frontend=api", "--auth=token", "--yes"]);
    const docs = await readFile(join(app, "docs/API.md"), "utf8");

    expect(docs).toContain("/api/v1/auth/login");
    expect(docs).toContain("/api/v1/auth/me");
    expect(docs).not.toContain("/api/auth/token");
  });

  test("metrics docs appear only when the extra is on", async () => {
    const root = await tempDir();
    const withMetrics = generateFromArgs(root, [
      "docs-m",
      "--frontend=api",
      "--auth=token",
      "--metrics",
      "--yes",
    ]);
    const without = generateFromArgs(root, [
      "docs-nm",
      "--frontend=api",
      "--auth=token",
      "--no-metrics",
      "--yes",
    ]);

    expect(await readFile(join(withMetrics, "docs/API.md"), "utf8")).toContain("/metrics");
    expect(await readFile(join(without, "docs/API.md"), "utf8")).not.toContain("/metrics");
  });

  test("non-api frontends do not ship an API-only doc", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["docs-html", "--frontend=server-htmx", "--yes"]);
    expect(existsSync(join(app, "docs/API.md"))).toBe(false);
  });
});

describe("production defaults", () => {
  test("boot does not migrate when APP_ENV=production", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["prod", "--yes"]);
    const createApp = await readFile(join(app, "src/bootstrap/createApp.ts"), "utf8");

    expect(createApp).toContain("const isProduction = isProductionEnv()");
    expect(createApp).toContain("migrate: runMigrate = !isProduction");
  });

  test("HTML apps explain the FEATURE_PUBLIC_READS default they ship", async () => {
    const root = await tempDir();
    const html = generateFromArgs(root, [
      "pr-html",
      "--frontend=server-htmx",
      "--auth=cookie",
      "--yes",
    ]);
    const env = await readFile(join(html, ".env.example"), "utf8");
    const readme = await readFile(join(html, "README.md"), "utf8");

    expect(env).toContain("FEATURE_PUBLIC_READS=false");
    expect(env).toContain("FEATURE_SAML=false");
    expect(readme).toContain("FEATURE_PUBLIC_READS=false");
  });

  test("api apps ship the production-safe default", async () => {
    const root = await tempDir();
    const api = generateFromArgs(root, ["pr-api", "--frontend=api", "--yes"]);
    const env = await readFile(join(api, ".env.example"), "utf8");
    expect(env).toContain("FEATURE_PUBLIC_READS=false");
  });

  test("every generated placeholder secret carries the change-me marker", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "ph",
      "--frontend=server-htmx",
      "--auth=cookie-token-jwt",
      "--scim",
      "--metrics",
      "--yes",
    ]);
    const env = await readFile(join(app, ".env.example"), "utf8");

    // The production guard rejects secrets matching /change-me/i, so any
    // placeholder without that marker would slip into production unnoticed.
    const secrets = [
      "SESSION_SECRET",
      "TOKEN_HASH_PEPPER",
      "METRICS_TOKEN",
      "SCIM_BEARER_TOKEN",
      "JWT_SECRET",
    ];
    for (const name of secrets) {
      const match = env.match(new RegExp(`^${name}=(.+)$`, "m"));
      if (match?.[1]) {
        expect(match[1]).toMatch(/change-me/i);
      }
    }
  });
});

describe("generated deploy files", () => {
  test("sqlite cookie app gets a production Dockerfile with a storage volume", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "deploy-lite",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie",
      "--yes",
    ]);
    const dockerfile = await readFile(join(app, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("FROM oven/bun:1.4 AS deps");
    expect(dockerfile).toContain("bun install --frozen-lockfile --production");
    expect(dockerfile).toContain("ENV APP_ENV=production");
    expect(dockerfile).toContain("ENV AUTH_DEV_HEADERS=false");
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain('VOLUME ["/app/storage"]');
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain('CMD ["bun", "run", "start"]');
    expect(dockerfile).not.toContain("AS frontend");

    const ignore = await readFile(join(app, ".dockerignore"), "utf8");
    expect(ignore.split("\n")).toEqual(
      expect.arrayContaining([".env", "node_modules", ".git", "!.env.example"]),
    );
    expect(ignore).not.toContain("frontend/dist");

    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("## Deploy");
    expect(readme).toContain("docker build -t deploy-lite .");
    expect(readme).toContain("mount a volume");

    const gitignore = await readFile(join(app, ".gitignore"), "utf8");
    expect(gitignore).toContain("storage/*.sqlite-wal");
  });

  test("postgres hybrid app builds the frontend inside the image and has no sqlite volume", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "deploy-hybrid",
      "--frontend=hybrid",
      "--database=postgres",
      "--auth=cookie-token",
      "--yes",
    ]);
    const dockerfile = await readFile(join(app, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("FROM oven/bun:1.4 AS frontend");
    expect(dockerfile).toContain("COPY --from=frontend /app/frontend/dist ./frontend/dist");
    expect(dockerfile).not.toContain("VOLUME");

    const ignore = await readFile(join(app, ".dockerignore"), "utf8");
    expect(ignore).toContain("frontend/node_modules");
    expect(ignore).toContain("frontend/dist");

    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("built inside the image");
    expect(readme).not.toContain("mount a volume");
  });

  test("README production list covers APP_URL, proxies, CORS, and the 503 health gate", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["prod-notes", "--frontend=api", "--auth=token", "--yes"]);
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("Set `APP_URL` to the public origin");
    expect(readme).toContain("TRUST_FORWARDED_FOR=true");
    expect(readme).toContain("Cross-origin browser calls are off in production");
    expect(readme).toContain("`GET /health` answers 503 until a notes row is readable");
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("# TRUST_FORWARDED_FOR=true");
  });
});
