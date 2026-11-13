import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiscoverModulesForTests } from "@getstrata/bootstrap/discoverModules";
import type { ExecutionPersistence } from "@getstrata/core/contracts/persistence";
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
import { jsonCsrfHeaders } from "../../helpers/jsonCsrf";
import { appTest, installGeneratedAppDependencies, repoRoot } from "./helpers";

const tempDirectories: string[] = [];
const ENV_KEYS = [
  "DATABASE_URL",
  "APP_DATABASE_URL",
  "APP_URL",
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
  installGeneratedAppDependencies(app);
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
    expect(scim).toContain(
      "ports.database.model(User).where({ email, tenant_id: tenantId(ports) }).first()",
    );
    expect(scim).toContain(
      "ports.database.model(User).where({ tenant_id: tenantId(ports) }).count()",
    );
    expect(scim).toContain(
      "ports.database.model(User).where({ tenant_id: tenantId(ports) }).offset(startIndex - 1).limit(count).get()",
    );
    expect(scim).toContain(
      "ports.database.model(User).where({ id, tenant_id: tenantId(ports) }).first()",
    );
    expect(scim).toContain("parsePositiveIntParam");
    expect(scim).toContain("ports.database.model(User).create({");
    expect(scim).toContain("tenant_id: tenantId(ports)");
    expect(scim).not.toContain("FROM users");
    expect(scim).not.toContain("INTO users");
    expect(scim).not.toMatch(/SELECT id, name, email FROM users"/);
    expect(await readFile(join(app, "src/modules/auth/index.ts"), "utf8")).toContain(
      "authServices.config.registrationEnabled",
    );
    expect(await readFile(join(app, "src/bootstrap/providers/auth.ts"), "utf8")).toContain(
      '(env.FEATURE_REGISTRATION ?? "true") !== "false"',
    );
    expect(await readFile(join(app, "src/db/migrations/0001_starter_schema.ts"), "utf8")).toContain(
      "auth_one_time_tokens",
    );
    expect(await readFile(join(app, "src/db/migrations/0001_starter_schema.ts"), "utf8")).toContain(
      "session_valid_after",
    );
    expect(await readFile(join(app, "src/models/Note.ts"), "utf8")).toContain("tenant_id");
  });

  appTest("cookie+token app rejects CSRF skip on garbage Bearer and requires MFA", async () => {
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
    process.env.APP_DATABASE_URL = "sqlite:./storage/app.sqlite";
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

    const { bootstrapApp } = await import(`${join(app, "src/bootstrap/createApp.ts")}`);
    async function startHttp() {
      const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
      const port = probe.port;
      await probe.stop(true);
      process.env.APP_URL = `http://127.0.0.1:${port}`;
      return bootstrapApp({ mode: "http", server: { port, native: { hostname: "127.0.0.1" } } });
    }
    const boot = await startHttp();
    await (await import(join(app, "src/db/migrate.ts"))).seed();
    const server = boot.server;
    if (!server) throw new Error("Expected application-owned HTTP server");
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
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ email: "demo@example.com" }),
      });
      expect(forged.status).toBe(401);
      expect(forged.headers.get("location")).toBeNull();

      const forgedWithCsrf = await fetch(`${origin}/forgot-password`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie: cookies,
          authorization: "Bearer garbage-token",
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ _token: csrf, email: "demo@example.com" }),
      });
      expect(forgedWithCsrf.status).toBe(401);
      expect(forgedWithCsrf.headers.get("location")).toBeNull();
      const missingCsrf = await fetch(`${origin}/forgot-password`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie: cookies, origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: "demo@example.com" }),
      });
      expect(missingCsrf.status).toBe(403);

      const allowed = await fetch(`${origin}/forgot-password`, {
        method: "POST",
        headers: {
          cookie: cookies,
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ _token: csrf, email: "demo@example.com" }),
        redirect: "manual",
      });
      expect(allowed.status).toBe(302);

      process.env.FEATURE_REGISTRATION = "false";
      // The admitted app retains its captured config; the alternate app captures the new flag.
      expect((await fetch(`${origin}/register`)).status).toBe(200);
      const disabled = await startHttp();
      const disabledServer = disabled.server;
      if (!disabledServer) throw new Error("Expected disabled-registration HTTP server");
      const disabledOrigin = `http://127.0.0.1:${disabledServer.port}`;
      try {
        const register = await fetch(`${disabledOrigin}/register`);
        expect(register.status).toBe(404);
        const apiRegister = await fetch(`${disabledOrigin}/api/v1/auth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "A", email: "a@example.com", password: "long-password" }),
        });
        expect(apiRegister.status).toBe(403);
        const registerCsrf = await jsonCsrfHeaders(disabledOrigin);
        const apiRegisterWithCsrf = await fetch(`${disabledOrigin}/api/v1/auth/register`, {
          method: "POST",
          headers: registerCsrf.headers,
          body: JSON.stringify({ name: "A", email: "a@example.com", password: "long-password" }),
        });
        expect(apiRegisterWithCsrf.status).toBe(404);
      } finally {
        expect(
          (await disabled.application.stop({ reason: "registration scenario complete" }))
            .successful,
        ).toBe(true);
        process.env.APP_URL = origin;
        process.env.FEATURE_REGISTRATION = "true";
      }

      expect((await fetch(`${origin}/scim/v2/Users`)).status).toBe(401);
      expect(
        (
          await fetch(`${origin}/scim/v2/Users`, {
            headers: { authorization: "Bearer " },
          })
        ).status,
      ).toBe(401);

      const secret = generateTotpSecret();
      await boot.invoke(
        { kind: "command", actor: { kind: "system", policy: "fixture.enable-mfa" } },
        ({ database }: ExecutionPersistence) =>
          database.execute({
            text: "UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE email = ?",
            params: [secret, "demo@example.com"],
          }),
      );
      const loginCsrf = await jsonCsrfHeaders(origin);
      const withoutMfa = await fetch(`${origin}/api/v1/auth/login`, {
        method: "POST",
        headers: loginCsrf.headers,
        body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
      });
      expect(withoutMfa.status).toBe(401);
      expect(await withoutMfa.json()).toMatchObject({ error: "mfa_required" });

      const withMfa = await fetch(`${origin}/api/v1/auth/login`, {
        method: "POST",
        headers: loginCsrf.headers,
        body: JSON.stringify({
          email: "demo@example.com",
          password: "StrataDemo!ChangeMe",
          mfa_code: generateTotp(secret),
        }),
      });
      expect(withMfa.status).toBe(200);
      expect(((await withMfa.json()) as { token: string }).token.startsWith("strp_")).toBe(true);

      const guestHome = await fetch(`${origin}/`);
      expect(guestHome.status).toBe(200);
      const guestHtml = await guestHome.text();
      expect(guestHtml).not.toContain("StrataDemo!ChangeMe");
      expect(guestHtml).not.toContain("demo@example.com");
      expect(guestHtml).not.toContain("admin@example.test");

      const htmlLoginPage = await fetch(`${origin}/login`);
      const htmlLoginHtml = await htmlLoginPage.text();
      const htmlCsrf = /name="_token" value="([^"]+)"/.exec(htmlLoginHtml)?.[1] ?? "";
      const htmlCookies = cookieHeader(htmlLoginPage);
      const htmlWithoutMfa = await fetch(`${origin}/login`, {
        method: "POST",
        headers: {
          cookie: htmlCookies,
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          _token: htmlCsrf,
          email: "demo@example.com",
          password: "StrataDemo!ChangeMe",
        }),
        redirect: "manual",
      });
      expect(htmlWithoutMfa.status).toBe(302);
      expect(htmlWithoutMfa.headers.get("location") ?? "").toContain("/login/mfa");
      expect(
        htmlWithoutMfa.headers.getSetCookie().some((item) => item.includes("strata_mfa_pending")),
      ).toBe(true);
    } finally {
      expect(
        (await boot.application.stop({ reason: "security fixture complete" })).successful,
      ).toBe(true);
    }
  });
});
