import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiscoverModulesForTests } from "@getstrata/bootstrap/discoverModules";
import { resetBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { resetDefaultDatabasePoolForTests } from "@getstrata/core/database/defaultConnection";
import { resetSqlDialect } from "@getstrata/core/database/dialect";
import { generateTotp, generateTotpSecret } from "@getstrata/core/security/totp";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { repoRoot } from "./helpers";

const tempDirectories: string[] = [];
const ENV_KEYS = [
  "DATABASE_URL",
  "APP_ENV",
  "FRONTEND_MODE",
  "AUTH_DEV_HEADERS",
  "TENANCY_DRIVER",
  "SESSION_SECRET",
  "FEATURE_REGISTRATION",
  "FEATURE_SCIM",
  "SCIM_BEARER_TOKEN",
  "SCIM_TENANT_TOKENS",
  "FEATURE_API_TOKENS",
  "TOKEN_HASH_PEPPER",
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
  const directory = await mkdtemp(join(tmpdir(), "strata-sec-"));
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

async function installWorkspaceApp(app: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  pkg.dependencies["@getstrata/core"] = `file:${join(repoRoot, "packages/strata-core")}`;
  pkg.dependencies["@getstrata/bootstrap"] = `file:${join(repoRoot, "packages/strata-bootstrap")}`;
  pkg.dependencies["@getstrata/cli"] = `file:${join(repoRoot, "packages/strata-cli")}`;
  await Bun.write(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const install = Bun.spawnSync({
    cmd: ["bun", "install"],
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(install.exitCode).toBe(0);
}

describe("starter security flows", () => {
  test("generated SCIM SQL is tenant-scoped and registration honors the flag", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "sec-sql",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie-token",
      "--tenancy=column",
      "--scim",
      "--mfa",
      "--yes",
    ]);
    const scim = await readFile(join(app, "src/modules/scim/index.ts"), "utf8");
    expect(scim).toContain("AND tenant_id =");
    expect(scim).not.toMatch(/SELECT id, name, email FROM users"/);
    expect(await readFile(join(app, "src/modules/auth/index.ts"), "utf8")).toContain(
      "FEATURE_REGISTRATION",
    );
    expect(await readFile(join(app, "src/db/migrate.ts"), "utf8")).toContain(
      "auth_one_time_tokens",
    );
    expect(await readFile(join(app, "src/db/migrate.ts"), "utf8")).toContain("session_valid_after");
    expect(await readFile(join(app, "src/models/Note.ts"), "utf8")).toContain("tenant_id");
  });

  test("cookie+token app rejects CSRF skip on garbage Bearer and requires MFA", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "sec-boot",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie-token",
      "--tenancy=column",
      "--scim",
      "--mfa",
      "--yes",
    ]);
    await installWorkspaceApp(app);
    process.chdir(app);
    process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.TENANCY_DRIVER = "column";
    process.env.SESSION_SECRET = "dev-session-secret-change-me-please-32ch";
    process.env.AUTH_DEV_HEADERS = "false";
    process.env.FEATURE_API_TOKENS = "true";
    process.env.TOKEN_HASH_PEPPER = "dev-token-pepper-change-me";
    process.env.FEATURE_SCIM = "true";
    process.env.SCIM_BEARER_TOKEN = "tenant-one-scim-token";
    process.env.SCIM_TENANT_TOKENS = "1:tenant-one-scim-token";
    process.env.MAIL_DRIVER = "log";
    process.env.FEATURE_REGISTRATION = "true";

    const { bootstrapApp, createAppServer } = await import(
      `${join(app, "src/bootstrap/createApp.ts")}`
    );
    const { closeDatabase, getSql } = await import(`${join(app, "src/bootstrap/database.ts")}`);
    const { routes } = await bootstrapApp();
    const server = createAppServer(routes, 0);
    const origin = `http://127.0.0.1:${server.port}`;

    try {
      const loginPage = await fetch(`${origin}/login`);
      const loginHtml = await loginPage.text();
      const csrf = /name="_token" value="([^"]+)"/.exec(loginHtml)?.[1] ?? "";
      const cookies = cookieHeader(loginPage);
      expect(loginPage.headers.getSetCookie().some((item) => item.includes("HttpOnly"))).toBe(true);

      const forged = await fetch(`${origin}/forgot-password`, {
        method: "POST",
        headers: {
          cookie: cookies,
          authorization: "Bearer garbage-token",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ email: "demo@example.com" }),
      });
      expect(forged.status).toBe(403);

      const allowed = await fetch(`${origin}/forgot-password`, {
        method: "POST",
        headers: {
          cookie: cookies,
          authorization: "Bearer garbage-token",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ _token: csrf, email: "demo@example.com" }),
        redirect: "manual",
      });
      expect(allowed.status).toBe(302);

      process.env.FEATURE_REGISTRATION = "false";
      const register = await fetch(`${origin}/register`);
      expect(register.status).toBe(404);
      const apiRegister = await fetch(`${origin}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "A", email: "a@example.com", password: "long-password" }),
      });
      expect(apiRegister.status).toBe(404);
      process.env.FEATURE_REGISTRATION = "true";

      expect((await fetch(`${origin}/scim/v2/Users`)).status).toBe(401);
      expect(
        (
          await fetch(`${origin}/scim/v2/Users`, {
            headers: { authorization: "Bearer " },
          })
        ).status,
      ).toBe(401);

      const secret = generateTotpSecret();
      await getSql().unsafe("UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE email = ?", [
        secret,
        "demo@example.com",
      ]);
      const withoutMfa = await fetch(`${origin}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
      });
      expect(withoutMfa.status).toBe(401);
      expect(await withoutMfa.json()).toMatchObject({ error: "mfa_required" });

      const withMfa = await fetch(`${origin}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "demo@example.com",
          password: "StrataDemo!ChangeMe",
          mfa_code: generateTotp(secret),
        }),
      });
      expect(withMfa.status).toBe(200);
      expect(((await withMfa.json()) as { token: string }).token.startsWith("strp_")).toBe(true);
    } finally {
      server.stop();
      await closeDatabase();
    }
  });
});
