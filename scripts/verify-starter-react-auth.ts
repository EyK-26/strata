/** Mounted React acceptance against real generated account endpoints, never mocked auth. */
import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const auth = process.argv.find((a) => a.startsWith("--auth="))?.slice(7);
const frontend = process.argv.find((a) => a.startsWith("--frontend="))?.slice(11);
assert.ok(
  auth && ["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"].includes(auth),
);
assert.ok(frontend === "spa-react" || frontend === "hybrid");
const dev = process.argv.includes("--dev");
const mfa = process.argv.includes("--mfa");
const expiry = process.argv.includes("--expiry");
const database = process.argv.find((a) => a.startsWith("--database="))?.slice(11) ?? "sqlite";
const tenancy = process.argv.find((a) => a.startsWith("--tenancy="))?.slice(10) ?? "none";
assert.ok(database === "sqlite" || database === "mysql" || database === "postgres");
assert.ok(
  tenancy === "none" || tenancy === "column" || (tenancy === "rls" && database === "postgres"),
);
const publishedVersion = process.argv.find((a) => a.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  database,
  [
    `--frontend=${frontend}`,
    `--auth=${auth}`,
    `--tenancy=${tenancy}`,
    "--cache=array",
    "--queue=sync",
    "--mail=log",
    "--no-docker",
    mfa ? "--mfa" : "--no-mfa",
    "--no-email-verification",
    "--no-scim",
    "--no-metrics",
  ],
  { publishedVersion },
);
const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reserve.port;
await reserve.stop(true);
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(k),
    ),
  ),
  APP_ENV: "local",
  APP_URL: origin,
  PORT: String(port),
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  TOKEN_HASH_PEPPER: crypto.randomUUID(),
  AUTH_DEV_HEADERS: "true",
  JWT_TTL_SECONDS: expiry ? "2" : "3600",
  TENANCY_DRIVER: tenancy,
  OTEL_SDK_DISABLED: "true",
};
async function command(args: string[]) {
  const p = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90000,
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  assert.equal(code, 0, out + err);
}
let server: ReturnType<typeof Bun.spawn> | undefined;
let devServer: ReturnType<typeof Bun.spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let cleaned: Promise<void> | undefined;
function cleanup() {
  cleaned ??= (async () => {
    await browser?.close();
    if (devServer) {
      try {
        process.kill(-devServer.pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      await devServer.exited;
    }
    if (server) {
      server.kill("SIGTERM");
      await server.exited;
    }
    await fixture.close();
  })();
  return cleaned;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
try {
  await writeFile(
    join(fixture.app, ".env"),
    await readFile(join(fixture.app, ".env.example"), "utf8"),
  );
  // Test bridge invokes the shipped client in the same browser module graph as AuthContext.
  await appendFile(
    join(fixture.app, "frontend/src/main.tsx"),
    '\nimport {apiFetch as acceptanceFetch,fetchResourceEtag as acceptanceEtag} from "./api/client";\nObject.assign(window,{acceptanceFetch,acceptanceEtag});\n',
  );
  await mkdir(join(fixture.app, "src/modules/acceptance"));
  await writeFile(
    join(fixture.app, "src/modules/acceptance/index.ts"),
    `import type {AppModule} from '@getstrata/bootstrap/contracts';\nimport {CORE_AUTH_TOKEN} from '@getstrata/bootstrap/config';\nimport type {AuthManager} from '@getstrata/core/auth/guard';\nimport {jsonResponse} from '@getstrata/core/http/response';\nexport default {name:'acceptance',routes({kernel,dependencies}){return {'/api/v1/acceptance-identity':{GET:kernel.wrapApi(async(request)=>{const user=await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);return jsonResponse({id:user.id,role:user.role},{headers:{etag:'identity-v1'}});})}};}} satisfies AppModule;`,
  );
  // Compile and exercise the ORM example shown to developers, rather than assuming it works.
  const home = await readFile(join(fixture.app, "frontend/src/pages/HomePage.tsx"), "utf8");
  const example = home.match(/<code>\{`([\s\S]*?)`}<\/code>/)?.[1];
  assert.ok(example, "Home must include its runnable module example");
  await mkdir(join(fixture.app, "src/modules/notes"));
  await writeFile(join(fixture.app, "src/modules/notes/index.ts"), example);
  await command(["run", "check"]);
  await command(["run", "db:migrate", "--seed"]);
  if (mfa) {
    const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
    await command([cli, "openapi:generate"]);
    await command([cli, "openapi:check"]);
    const spec = JSON.parse(await readFile(join(fixture.app, "docs/openapi.json"), "utf8"));
    for (const path of [
      "/api/v1/auth/register",
      "/api/v1/auth/confirm-password",
      "/api/v1/auth/mfa",
    ])
      assert.ok(spec.paths[path], `Missing JSON account operation ${path}`);
    for (const path of ["/login", "/register", "/account/mfa"])
      assert.equal(spec.paths[path], undefined, "HTML account pages stay outside OpenAPI");
  }
  await command(["run", "frontend:install"]);
  await command(["run", "frontend:build"]);
  await command([
    join(fixture.app, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "-p",
    "frontend/tsconfig.json",
  ]);
  server = Bun.spawn(
    [process.execPath, join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "start"],
    {
      cwd: fixture.app,
      env,
      stdout: Bun.file(join(fixture.app, "server.log")),
      stderr: Bun.file(join(fixture.app, "server.error.log")),
    },
  );
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(100);
  }
  assert.ok(ready, "Generated backend must start");
  let browserOrigin = origin;
  if (dev) {
    const r = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const frontendPort = r.port;
    await r.stop(true);
    browserOrigin = `http://127.0.0.1:${frontendPort}`;
    devServer = Bun.spawn([process.execPath, "run", "frontend:dev"], {
      cwd: fixture.app,
      env: { ...env, API_ORIGIN: origin, FRONTEND_PORT: String(frontendPort) },
      detached: true,
      stdout: Bun.file(join(fixture.app, "dev.log")),
      stderr: Bun.file(join(fixture.app, "dev.error.log")),
    });
    let devReady = false;
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(`${browserOrigin}/app/`)).ok) {
          devReady = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    assert.ok(devReady);
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      console.log(
        `HTTP ${new URL(response.url()).pathname}: ${response.status()} ${body?.error ?? ""}`,
      );
    }
  });
  const calls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api")) calls.push(new URL(r.url()).pathname);
  });
  await page.goto(`${browserOrigin}/app/`);
  if (auth !== "headers") {
    const csrf = await page.request.get(`${browserOrigin}/api/v1/auth/csrf`);
    assert.equal(csrf.status(), 200);
    const { token } = (await csrf.json()) as { token: string };
    const crossSite = await page.request.post(
      `${browserOrigin}${auth === "jwt" ? "/api/auth/token" : "/api/v1/auth/login"}`,
      {
        headers: { origin: "https://untrusted.example.test", "x-csrf-token": token },
        data: { email: "demo@example.com", password: "StrataDemo!ChangeMe" },
      },
    );
    assert.equal(
      crossSite.status(),
      403,
      "Proxy and built runtime must retain cross-site CSRF refusal",
    );
  }
  if (auth === "headers") {
    await page.getByRole("heading", { name: "Development identity", exact: true }).waitFor();
    assert.equal(await page.locator("input[type=password]").count(), 0);
    await page.getByLabel("User ID", { exact: true }).fill("42");
    await page.getByRole("button", { name: "Use development identity" }).click();
  } else {
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel("Password", { exact: true }).fill("Wrong!Password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Invalid credentials", { exact: true }).waitFor();
    await page.getByLabel("Password", { exact: true }).fill("StrataDemo!ChangeMe");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  const identity = await page.evaluate(async () => {
    const w = globalThis as unknown as {
      acceptanceFetch: (p: string) => Promise<{ id: number | string; role: string }>;
    };
    return w.acceptanceFetch("/acceptance-identity");
  });
  assert.ok(identity.id);
  const etag = await page.evaluate(async () =>
    (globalThis as unknown as { acceptanceEtag: (p: string) => Promise<string> }).acceptanceEtag(
      "/acceptance-identity",
    ),
  );
  assert.equal(etag, "identity-v1", "ETag fetch must use the selected authenticated transport");
  const notes = await page.evaluate(async () =>
    (
      globalThis as unknown as { acceptanceFetch: (p: string) => Promise<{ data: unknown[] }> }
    ).acceptanceFetch("/notes"),
  );
  assert.ok(
    Array.isArray(notes.data),
    "The displayed ORM example must actually serve its resource",
  );
  if (auth === "headers") {
    assert.equal(String(identity.id), "42");
    assert.ok(
      !calls.some((p) => p.includes("/auth/")),
      "Header UI must not call absent account/CSRF endpoints",
    );
  }
  assert.deepEqual(
    await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })),
    { local: [], session: [] },
    "Credentials remain memory only",
  );
  async function loginAgain(code?: string) {
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel("Password", { exact: true }).fill("StrataDemo!ChangeMe");
    if (code) await page.getByLabel("Authenticator or recovery code", { exact: true }).fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  if (auth !== "headers" && !mfa) {
    if (auth === "token" || expiry) {
      if (auth === "token") {
        await writeFile(
          join(fixture.app, "expire-token.ts"),
          `import './src/bootstrap/preload.ts';\nimport {getSql} from './src/bootstrap/database.ts';getSql();\nconst {ApiToken}=await import('./src/models/ApiToken.ts');\nconst {runWithTenantDatabase}=await import('@getstrata/core/tenant/tenantDatabaseScope');await runWithTenantDatabase({id:1,slug:'default'},async()=>{for(const token of await ApiToken.query().get())await token.update({expires_at:'2000-01-01 00:00:00'});});\nconst {closeDatabase}=await import('./src/bootstrap/database.ts');await closeDatabase();`,
        );
        await command(["expire-token.ts"]);
      } else await Bun.sleep(2200);
      const expired = await page.evaluate(async () => {
        try {
          await (
            globalThis as unknown as { acceptanceFetch: (p: string) => Promise<unknown> }
          ).acceptanceFetch("/acceptance-identity");
          return 200;
        } catch (error) {
          return (error as { status: number }).status;
        }
      });
      assert.equal(expired, 401, "Expired real credentials must be rejected");
      await loginAgain();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    }
    // Administrative account state changes use only the generated model and public ORM.
    await writeFile(
      join(fixture.app, "account-state.ts"),
      `import './src/bootstrap/preload.ts';\nimport {getSql} from './src/bootstrap/database.ts';getSql();\nconst {User}=await import('./src/models/User.ts');\nconst {runWithTenantDatabase}=await import('@getstrata/core/tenant/tenantDatabaseScope');await runWithTenantDatabase({id:1,slug:'default'},async()=>{const user=await User.query().where({email:'demo@example.com'}).first();if(!user)throw new Error('Missing fixture user');await user.update({is_active:process.argv.includes('--active')});});\nconst {closeDatabase}=await import('./src/bootstrap/database.ts');await closeDatabase();`,
    );
    await command(["account-state.ts"]);
    const revoked = await page.evaluate(async () => {
      try {
        await (
          globalThis as unknown as { acceptanceFetch: (p: string) => Promise<unknown> }
        ).acceptanceFetch("/acceptance-identity");
        return 200;
      } catch (error) {
        return (error as { status: number }).status;
      }
    });
    assert.equal(revoked, 401, "Disabled accounts must invalidate UI on a real guard rejection");
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await command(["account-state.ts", "--active"]);
    await loginAgain();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  }
  if (mfa) {
    const setup = await page.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          acceptanceFetch: (p: string, o?: RequestInit) => Promise<{ secret: string }>;
        }
      ).acceptanceFetch;
      await api("/auth/confirm-password", {
        method: "POST",
        body: JSON.stringify({ password: "StrataDemo!ChangeMe" }),
      });
      return api("/auth/mfa");
    });
    const { generateTotp } = await import(fixture.resolve("@getstrata/core/security/totp"));
    const enrolled = await page.evaluate(
      async ({ secret, code }) =>
        (
          globalThis as unknown as {
            acceptanceFetch: (p: string, o?: RequestInit) => Promise<{ recoveryCodes: string[] }>;
          }
        ).acceptanceFetch("/auth/mfa", { method: "POST", body: JSON.stringify({ secret, code }) }),
      { secret: setup.secret, code: generateTotp(setup.secret) },
    );
    const recovery = enrolled.recoveryCodes[0];
    assert.ok(recovery);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await loginAgain();
    await page.getByText("mfa_required", { exact: true }).waitFor();
    await page.getByLabel("Authenticator or recovery code", { exact: true }).fill(recovery);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await loginAgain(recovery);
    await page.getByText("mfa_invalid", { exact: true }).waitFor();
    await page
      .getByLabel("Authenticator or recovery code", { exact: true })
      .fill(generateTotp(setup.secret));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  }
  await page.reload();
  if (auth === "token" || auth === "jwt" || auth === "headers") {
    await page
      .getByRole("heading", {
        name: auth === "headers" ? "Development identity" : "Sign in",
        exact: true,
      })
      .waitFor();
  } else {
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  }
  if (auth === "token" || auth === "jwt") {
    await loginAgain();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  }
  if (auth === "headers") {
    await page.getByLabel("User ID", { exact: true }).fill("42");
    await page.getByRole("button", { name: "Use development identity" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("heading", { name: "Development identity", exact: true }).waitFor();
    await page.getByLabel("User ID", { exact: true }).fill("42");
    await page.getByRole("button", { name: "Use development identity" }).click();
    server.kill("SIGTERM");
    await server.exited;
    env.AUTH_DEV_HEADERS = "false";
    server = Bun.spawn(
      [process.execPath, join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "start"],
      {
        cwd: fixture.app,
        env,
        stdout: Bun.file(join(fixture.app, "disabled.log")),
        stderr: Bun.file(join(fixture.app, "disabled.error.log")),
      },
    );
    let restarted = false;
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(`${origin}/health`)).ok) {
          restarted = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    assert.ok(restarted);
    const denied = await page.evaluate(async () => {
      try {
        await (
          globalThis as unknown as { acceptanceFetch: (p: string) => Promise<unknown> }
        ).acceptanceFetch("/acceptance-identity");
        return 200;
      } catch (error) {
        return (error as { status: number }).status;
      }
    });
    assert.equal(
      denied,
      401,
      "A client-side identity must never bypass disabled server header auth",
    );
    await page.getByRole("heading", { name: "Development identity", exact: true }).waitFor();
  }
  assert.deepEqual(errors, [], "Mounted React must have no runtime errors");
  console.log(
    `PASS mounted ${database}/${tenancy}/${frontend}/${auth}${dev ? "/dev" : ""}${mfa ? "/mfa" : ""}${expiry ? "/expiry" : ""}: login, wrong password where applicable, real guard identity, reload lifetime, logout and no credential persistence`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
