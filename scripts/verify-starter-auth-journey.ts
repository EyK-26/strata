/** External installed app, actual HTTP/CSRF and SMTP through an owned Mailpit.
 * Use --published=VERSION and STARTER_JOURNEY_PARENT to qualify registry output. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExecutionPersistence,
  PersistenceInvocation,
} from "@getstrata/core/contracts/persistence";
import type { ServiceDeclaration } from "@getstrata/core/contracts/services";
import type {
  RepositoryEffectsDeclaration,
  TransactionalRepositoryListener,
} from "@getstrata/core/database/definitions";
import type { Model } from "@getstrata/core/database/model";
import type { TransactionSession } from "@getstrata/core/database/session";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";
import { jsonCsrfHeaders, mergeCookies } from "../tests/helpers/jsonCsrf";
import { startOwnedMailpit } from "../tests/helpers/ownedMailpit";
import { starterJourneyProfiles } from "../tests/helpers/starterJourneyProfiles";

const selectedProfile = starterJourneyProfiles.find((item) => item.name === process.argv[2]);
assert.ok(selectedProfile, "Choose a registered starter journey profile.");
const profile = selectedProfile;
const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.split("=")[1];
const resetRace = process.argv.includes("--reset-race");
const fixture = await createGeneratedSecurityApp(
  profile.database,
  [
    `--frontend=${profile.frontend}`,
    `--auth=${profile.auth}`,
    `--tenancy=${profile.tenancy}`,
    "--mail=smtp",
    "--cache=array",
    "--queue=sync",
    "--no-scim",
    "--no-metrics",
    "--no-docker",
  ],
  { publishedVersion, parentDirectory: process.env.STARTER_JOURNEY_PARENT },
);
const container = `strata-signup-mail-${crypto.randomUUID()}`;
let mail: Awaited<ReturnType<typeof startOwnedMailpit>> | undefined;
let stop: (() => Promise<void>) | undefined;
const cwd = process.cwd();
const previousEnvironment = { ...process.env };
const failures: unknown[] = [];
let invoke: PersistenceInvocation | undefined;
const termination = new AbortController();
const terminationFailure = new Error("SMTP journey interrupted by SIGTERM");
let completedMessage: string | undefined;
async function journeyFetch(input: Parameters<typeof fetch>[0], init: RequestInit = {}) {
  termination.signal.throwIfAborted();
  return globalThis.fetch(input, {
    ...init,
    signal: AbortSignal.any([termination.signal, init.signal ?? AbortSignal.timeout(10000)]),
  });
}
function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
async function closeApplication(): Promise<void> {
  const close = stop;
  stop = undefined;
  invoke = undefined;
  await close?.();
}
async function all<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  throwFailures(
    settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    "Concurrent journey clients failed.",
  );
  return settled.map((result) => {
    assert.equal(result.status, "fulfilled");
    return result.value;
  });
}
async function availablePort(): Promise<number> {
  const errors: unknown[] = [];
  let probe: ReturnType<typeof Bun.serve> | undefined;
  let port: number | undefined;
  try {
    probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    port = probe.port;
    assert.ok(port);
  } catch (error) {
    errors.push(error);
  }
  try {
    await probe?.stop(true);
  } catch (error) {
    errors.push(error);
  }
  throwFailures(errors, "Journey origin probe and cleanup failed.");
  assert.ok(port);
  return port;
}
function docker(args: string[]) {
  const result = Bun.spawnSync(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
    timeout: 30000,
  });
  assert.equal(
    result.exitCode,
    0,
    `Owned Mailpit command failed: ${new TextDecoder().decode(result.stderr)}`,
  );
  return new TextDecoder().decode(result.stdout).trim();
}
let cleanupPromise: Promise<void> | undefined;
function cleanup(): Promise<void> {
  cleanupPromise ??= (async () => {
    const errors: unknown[] = [];
    try {
      await closeApplication();
    } catch (error) {
      errors.push(error);
    }
    try {
      await mail?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      process.chdir(cwd);
    } catch (error) {
      errors.push(error);
    }
    try {
      for (const key of Object.keys(process.env))
        if (!(key in previousEnvironment)) delete process.env[key];
      Object.assign(process.env, previousEnvironment);
    } catch (error) {
      errors.push(error);
    }
    try {
      await fixture.close();
    } catch (error) {
      errors.push(error);
    }
    throwFailures(errors, "Journey owned resource cleanup failed.");
  })();
  return cleanupPromise;
}
// Let the in-flight body unwind (including migration/stream settlement) before
// its ordinary finally tears down owners. Never drop fixtures under live work.
const terminate = () => {
  termination.abort(terminationFailure);
  process.exitCode = 143;
};
process.once("SIGTERM", terminate);
try {
  // Docker is authoritative about admission; created-but-unstarted containers
  // are owned and cleaned before a narrow port-collision retry.
  mail = await startOwnedMailpit(docker, container);
  const mailApi = `http://127.0.0.1:${mail.httpPort}`;
  const mailPort = String(mail.smtpPort);
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      ready = (await journeyFetch(`${mailApi}/readyz`)).ok;
    } catch {}
    if (ready) break;
    await Bun.sleep(50);
  }
  assert.ok(ready, "Owned Mailpit must become ready.");
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
    DB_CONNECTION: profile.database === "postgres" ? "pgsql" : profile.database,
    APP_ENV: "local",
    APP_DEBUG: "false",
    APP_URL: origin,
    FRONTEND_MODE: profile.frontend,
    APP_KEY_PREFIX: "journey",
    APP_NAME: "Starter qualification",
    TENANCY_DRIVER: profile.tenancy,
    AUTH_DEV_HEADERS: "false",
    TENANCY_DEV_HEADERS: "false",
    REDIS_URL: "",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    MAIL_DRIVER: "smtp",
    MAIL_HOST: "127.0.0.1",
    MAIL_PORT: mailPort,
    MAIL_SECURE: "false",
    MAIL_FROM: "qualification@example.test",
    MAIL_USERNAME: "",
    MAIL_PASSWORD: "",
    FEATURE_EMAIL_VERIFICATION: "true",
    FEATURE_MFA: "true",
    FEATURE_API_TOKENS: "true",
    FEATURE_REGISTRATION: "true",
    FEATURE_OAUTH: "false",
    FEATURE_SAML: "false",
    FEATURE_SCIM: "false",
    SESSION_SECRET: "qualification-session-secret-at-least-32-characters",
    JWT_SECRET: "qualification-jwt-secret-at-least-32-characters",
    TOKEN_HASH_PEPPER: "qualification-token-pepper",
    KMS_ENCRYPTION_KEY: "a".repeat(64),
    OTEL_SDK_DISABLED: "true",
  });
  delete process.env.STRATA_SCHEMA;
  delete process.env.KMS_ENCRYPTION_KEYRING;
  delete process.env.KMS_ENCRYPTION_ACTIVE_KEY;
  process.chdir(fixture.app);
  const migration = Bun.spawn(
    [
      process.execPath,
      join(fixture.app, "node_modules/@getstrata/cli/cli.ts"),
      "migrate",
      "--seed",
    ],
    {
      cwd: fixture.app,
      env: {
        ...process.env,
        DATABASE_URL: fixture.migrationUrl,
        APP_DATABASE_URL: fixture.migrationUrl,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    },
  );
  const migrationResults = await Promise.allSettled([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ]);
  throwFailures(
    migrationResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    "Journey migration process/streams failed.",
  );
  const [code, out, err] = migrationResults.map((result) => {
    assert.equal(result.status, "fulfilled");
    return result.value;
  });
  assert.equal(code, 0, `${out}${err}`);
  for (const key of [
    "MIGRATION_DATABASE_URL",
    "MYSQL_OBSERVABILITY_ADMIN_URL",
    "MYSQL_URL",
    "RLS_TEST_DATABASE_URL",
    "POSTGRES_PASSWORD",
    "STRATA_APP_PASSWORD",
  ])
    delete process.env[key];
  const { bootstrapApp } = await import(join(fixture.app, "src/bootstrap/createApp.ts"));
  const { User, UserRepository } = await import(join(fixture.app, "src/models/User.ts"));
  const { AuthOneTimeToken, AuthOneTimeTokenRepository } = await import(
    join(fixture.app, "src/models/AuthOneTimeToken.ts")
  );
  const { createServiceToken } = (await import(
    fixture.resolve("@getstrata/core/contracts/token")
  )) as typeof import("@getstrata/core/contracts/token");
  const { valueService } = (await import(
    fixture.resolve("@getstrata/core/contracts/services")
  )) as typeof import("@getstrata/core/contracts/services");
  const { repositoryEffects } = (await import(
    fixture.resolve("@getstrata/core/database/definitions")
  )) as typeof import("@getstrata/core/database/definitions");
  const { generateTotp } = await import(fixture.resolve("@getstrata/core/security/totp"));
  async function bootApplication(
    services: readonly ServiceDeclaration[] = [],
    effects: readonly RepositoryEffectsDeclaration[] = [],
  ) {
    termination.signal.throwIfAborted();
    const boot = await bootstrapApp({
      migrate: false,
      mode: "http",
      server: { port, native: { hostname: "127.0.0.1" } },
      services,
      persistence: { repositoryEffects: effects },
    });
    const owner = boot.application;
    stop = async () => {
      const result = await owner.stop({ reason: "SMTP journey phase complete" });
      if (!result.successful)
        throw new Error("Journey application cleanup was not confirmed", { cause: result });
    };
    invoke = boot.invoke;
    assert.ok(boot.server);
    assert.equal(boot.server.url.origin, origin);
    if (profile.frontend === "api") {
      const apiDocs = await readFile(join(fixture.app, "docs/API.md"), "utf8");
      for (const row of apiDocs.matchAll(/\| `(GET|POST)` \| `([^`]+)`/g)) {
        const path = row[2];
        assert.ok(path && path in boot.routes, `Generated docs advertise absent route ${path}.`);
      }
    }
  }
  await bootApplication();
  type UserFields = {
    id: number;
    tenant_id?: number;
    email: string;
    password: string;
    auth_version: number;
    email_verified_at: Date | string | null;
    mfa_secret: string | null;
    mfa_enabled: number | boolean;
    mfa_recovery_codes: string | null;
  };
  type TokenFields = {
    id: number;
    user_id: number;
    purpose: string;
    consumed_at: Date | string | null;
  };
  const tenant = { id: 1, slug: "default" };
  const userPredicate = (email: string) => ({
    email,
    ...(profile.tenancy === "none" ? {} : { tenant_id: tenant.id }),
  });
  const run = <T>(work: (ports: ExecutionPersistence) => Promise<T>) => {
    termination.signal.throwIfAborted();
    assert.ok(invoke);
    return invoke(
      { kind: "command", tenant, actor: { kind: "system", policy: "fixture.smtp-journey" } },
      work,
    );
  };
  const withSelected = <T>(work: (selected: TransactionSession) => Promise<T>) =>
    run(({ database, policy }) =>
      profile.tenancy === "rls"
        ? policy.run(database, { kind: "tenant", tenantId: tenant.id }, work)
        : database.transaction(work),
    );
  const withModels = <T>(
    work: (
      users: import("@getstrata/core/database/definitions").BoundModel<
        UserFields,
        "id",
        Model<UserFields, "id">
      >,
      tokens: import("@getstrata/core/database/definitions").BoundModel<
        TokenFields,
        "id",
        Model<TokenFields, "id">
      >,
    ) => Promise<T>,
  ) =>
    withSelected((selected) =>
      work(
        selected.model<UserFields, "id", Model<UserFields, "id">>(User),
        selected.model<TokenFields, "id", Model<TokenFields, "id">>(AuthOneTimeToken),
      ),
    );
  const csrf = await jsonCsrfHeaders(origin);
  let cookie = csrf.cookie;
  const cookieAuth = profile.auth.includes("cookie");
  const browser =
    cookieAuth && (profile.frontend === "server-htmx" || profile.frontend === "hybrid");
  const email = `journey-${crypto.randomUUID()}@example.test`;
  const password = "Original!Password123",
    replacement = "Replacement!Password456";
  async function request(
    path: string,
    body?: Record<string, string>,
    browserRequest = browser,
    explicitCookie = cookie,
  ) {
    const response = await journeyFetch(`${origin}${path}`, {
      method: body ? "POST" : "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: {
        cookie: explicitCookie,
        origin,
        accept: browserRequest ? "text/html" : "application/json",
        ...(body
          ? {
              "x-csrf-token": csrf.token,
              "content-type": browserRequest
                ? "application/x-www-form-urlencoded"
                : "application/json",
            }
          : {}),
      },
      body: body
        ? browserRequest
          ? new URLSearchParams({ ...body, _token: csrf.token })
          : JSON.stringify(body)
        : undefined,
    });
    cookie = mergeCookies(response, cookie);
    return response;
  }
  async function status(response: Response, expected: number, label: string) {
    const body = await response.text();
    if (response.headers.get("content-type")?.includes("application/json")) {
      assert.match(response.headers.get("cache-control") ?? "", /(?:^|[ ,])no-store(?:$|[ ,])/);
    }
    assert.equal(response.status, expected, `${profile.name}: ${label}: ${body.slice(0, 300)}`);
    return body;
  }
  async function mailLink(subject: string) {
    const list = (await (await journeyFetch(`${mailApi}/api/v1/messages`)).json()) as {
      messages: { ID: string; Subject: string; To: { Address: string }[] }[];
    };
    const message = list.messages.find(
      (item: { Subject: string; To: { Address: string }[] }) =>
        item.Subject === subject && item.To.some((to) => to.Address === email),
    );
    assert.ok(message, `Actual SMTP must deliver ${subject} to this owned recipient.`);
    const full = (await (await journeyFetch(`${mailApi}/api/v1/message/${message.ID}`)).json()) as {
      Text: string;
    };
    const link = String(full.Text).match(/https?:\/\/[^\s]+/)?.[0];
    assert.ok(link, "SMTP message must carry a signed actionable link.");
    const url = new URL(link);
    assert.equal(url.origin, origin);
    return `${url.pathname}${url.search}`;
  }
  async function deliveredTo(recipient: string) {
    const list = (await (await journeyFetch(`${mailApi}/api/v1/messages`)).json()) as {
      messages: { To: { Address: string }[] }[];
    };
    return list.messages.filter((item) => item.To.some((to) => to.Address === recipient)).length;
  }
  const register = browser ? "/register" : "/api/v1/auth/register";
  const payload = { name: "New Starter User", email, password };
  const denied = await journeyFetch(`${origin}${register}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(payload),
    redirect: "manual",
  });
  await status(denied, 403, "missing CSRF signup rejected");
  await status(await request(register, payload), browser ? 302 : 201, "fresh registration");
  // Duplicate signup remains neutral and never replaces the original password.
  await status(
    await request(register, { ...payload, password: "Other!Password789" }),
    browser ? 302 : 201,
    "duplicate registration",
  );
  assert.equal(await deliveredTo(email), 1, "Duplicate registration must not send a second token.");
  const readUser = () =>
    withModels(async (User, _tokens) => {
      const user = await User.where(userPredicate(email)).first();
      assert.ok(user);
      if (profile.tenancy !== "none") assert.equal(user.get("tenant_id"), tenant.id);
      return user;
    });
  const registered = await readUser();
  assert.ok(registered);
  assert.equal(await Bun.password.verify(password, registered.get("password")), true);
  assert.equal(registered.get("email_verified_at"), null);
  assert.equal(await withModels((User, _tokens) => User.where(userPredicate(email)).count()), 1);
  const verify = await mailLink("Verify your email");
  const tampered = new URL(verify, origin);
  tampered.searchParams.set("token", "tampered");
  await status(
    await request(tampered.pathname + tampered.search, browser ? undefined : {}, browser),
    403,
    "signature tampering",
  );
  await status(
    await request(verify, browser ? undefined : {}, browser),
    browser ? 302 : 200,
    "email verification",
  );
  const replay = await request(verify, browser ? undefined : {}, browser);
  await status(replay, browser ? 302 : 403, "verification replay");
  assert.ok((await readUser()).get("email_verified_at"));
  assert.equal(
    await withModels((_users, AuthOneTimeToken) =>
      AuthOneTimeToken.where({ user_id: registered.get("id"), purpose: "email_verify" })
        .whereNull("consumed_at")
        .count(),
    ),
    0,
  );
  const loginPath = browser
    ? "/login"
    : profile.auth === "jwt"
      ? "/api/auth/token"
      : "/api/v1/auth/login";
  const login = await request(loginPath, { email, password });
  let token: string | undefined;
  if (browser) await status(login, 302, "browser login");
  else if (cookieAuth) await status(login, 200, "JSON cookie login");
  else {
    assert.equal(login.status, 200);
    token = ((await login.json()) as { token: string }).token;
    assert.ok(token);
  }
  const oldCookie = cookie;
  const protectedPath = profile.auth === "jwt" ? "/api/user" : "/api/v1/auth/me";
  async function protectedStatus(expected: number) {
    const response = await journeyFetch(origin + protectedPath, {
      headers: token ? { authorization: `Bearer ${token}` } : { cookie: oldCookie },
      redirect: "manual",
    });
    await status(response, expected, "credential validity");
  }
  await protectedStatus(200);
  // A separate guest can request/reset while the original credential is still live.
  cookie = csrf.cookie;
  await status(
    await request(browser ? "/forgot-password" : "/api/v1/auth/forgot-password", { email }),
    browser ? 302 : 200,
    "forgot password SMTP",
  );
  const reset = await mailLink("Reset your password");
  if (browser) await status(await request(reset), 200, "reset form");
  if (!browser) {
    await status(
      await journeyFetch(origin + reset, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          cookie,
          origin,
          "x-csrf-token": csrf.token,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: "{",
      }),
      400,
      "malformed reset JSON is a client error without consuming proof",
    );
    await status(
      await request(reset, { password: "short" }),
      403,
      "invalid reset password does not consume proof",
    );
  }
  await status(
    await request(reset, { password: replacement, email }),
    browser ? 302 : 200,
    "password reset",
  );
  await protectedStatus(401);
  await status(
    await request(reset, { password, email }),
    browser ? 200 : 403,
    "reset replay denied",
  );
  const freshLogin = await request(loginPath, { email, password: replacement });
  await status(freshLogin, browser ? 302 : 200, "replacement password login");
  assert.equal(await Bun.password.verify(replacement, (await readUser()).get("password")), true);
  assert.equal((await readUser()).get("auth_version"), 1);
  if (browser) {
    const setup = await status(await request("/account/mfa"), 200, "MFA setup page");
    const secret = setup.match(/name="secret" value="([^"]+)"/)?.[1];
    assert.ok(secret);
    await status(
      await request("/confirm-password", { password: replacement }),
      302,
      "password confirmation",
    );
    const beforeEnroll = cookie;
    const enrolled = await status(
      await request("/account/mfa", { secret, code: generateTotp(secret) }),
      200,
      "MFA enrollment",
    );
    const recovery = enrolled.match(/<li><code>([^<]+)<\/code><\/li>/)?.[1];
    assert.ok(recovery, "MFA enrollment must show usable recovery codes once.");
    const fenced = await journeyFetch(`${origin}/api/v1/auth/me`, {
      headers: { cookie: beforeEnroll },
      redirect: "manual",
    });
    await status(fenced, 401, "MFA enrollment revokes previous session");
    cookie = csrf.cookie;
    const pending = await request("/login", { email, password: replacement });
    assert.equal(pending.headers.get("location"), "/login/mfa");
    await status(pending, 302, "MFA challenge required");
    await status(
      await request("/login/mfa", { code: generateTotp(secret) }),
      302,
      "TOTP completes login",
    );
    await status(
      await request("/api/v1/auth/me", undefined, false),
      200,
      "MFA session authenticates",
    );
    await status(await request("/logout", {}), 302, "logout");
    cookie = csrf.cookie;
    await status(
      await request("/login", { email, password: replacement }),
      302,
      "recovery login pending",
    );
    await status(
      await request("/login/mfa", { code: recovery }),
      302,
      "recovery code completes login",
    );
    await status(await request("/logout", {}), 302, "recovery logout");
    cookie = csrf.cookie;
    await status(
      await request("/login", { email, password: replacement }),
      302,
      "replay login pending",
    );
    await status(await request("/login/mfa", { code: recovery }), 200, "recovery replay rejected");
    await status(
      await request("/api/v1/auth/me", undefined, false),
      401,
      "replayed recovery cannot authenticate",
    );
  }
  if (cookieAuth && !browser) {
    await status(
      await journeyFetch(`${origin}/api/v1/auth/mfa`, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          cookie,
          origin,
          "x-csrf-token": csrf.token,
          "HX-Request": "true",
          accept: "text/html",
          "content-type": "application/json",
        },
        body: JSON.stringify({ secret: "invalid", code: "000000" }),
      }),
      423,
      "explicit API confirmation stays JSON for HTMX headers",
    );
    await status(
      await request("/api/v1/auth/mfa", { secret: "invalid", code: "000000" }),
      423,
      "MFA requires password confirmation",
    );
    await status(
      await request("/api/v1/auth/confirm-password", { password: "wrong" }),
      422,
      "wrong confirmation password",
    );
    const setup = JSON.parse(
      await status(await request("/api/v1/auth/mfa"), 200, "JSON MFA setup"),
    ) as { secret: string; otpauth: string };
    assert.ok(setup.secret);
    assert.ok(setup.otpauth.startsWith("otpauth://totp/"));
    await status(
      await request("/api/v1/auth/confirm-password", { password: replacement }),
      200,
      "JSON password confirmation",
    );
    await status(
      await request("/api/v1/auth/mfa", { secret: setup.secret, code: "invalid" }),
      422,
      "invalid TOTP rejected",
    );
    await status(
      await request("/api/v1/auth/mfa", { secret: "!!!!", code: "123456" }),
      422,
      "malformed MFA secret rejected",
    );
    const beforeEnroll = cookie;
    const enrolled = JSON.parse(
      await status(
        await request("/api/v1/auth/mfa", {
          secret: setup.secret,
          code: generateTotp(setup.secret),
        }),
        200,
        "JSON MFA enrollment",
      ),
    ) as { recoveryCodes: string[] };
    const recovery = enrolled.recoveryCodes[0];
    assert.ok(recovery);
    assert.equal((await readUser()).get("auth_version"), 2);
    await status(
      await request(protectedPath, undefined, false, beforeEnroll),
      401,
      "JSON MFA revokes session",
    );
    cookie = csrf.cookie;
    const challenge = JSON.parse(
      await status(
        await request(loginPath, { email, password: replacement }),
        401,
        "JSON MFA challenge",
      ),
    ) as { error: string };
    assert.equal(challenge.error, "mfa_required");
    await status(
      await request(loginPath, {
        email,
        password: replacement,
        mfa_code: generateTotp(setup.secret),
      }),
      200,
      "JSON TOTP login",
    );
    await status(await request(protectedPath), 200, "JSON MFA authenticated");
    await status(
      await request("/api/v1/auth/mfa", { secret: setup.secret, code: generateTotp(setup.secret) }),
      423,
      "prior epoch confirmation cannot authorize re-enrollment",
    );
    await status(await request("/api/v1/auth/logout", {}), 200, "JSON logout");
    cookie = csrf.cookie;
    await status(
      await request(loginPath, { email, password: replacement, mfa_code: recovery }),
      200,
      "JSON recovery login",
    );
    await status(await request("/api/v1/auth/logout", {}), 200, "JSON recovery logout");
    cookie = csrf.cookie;
    await status(
      await request(loginPath, { email, password: replacement, mfa_code: recovery }),
      422,
      "JSON recovery replay denied",
    );
    await status(await request(protectedPath), 401, "recovery replay has no session");
  }
  if (resetRace) {
    // Two independent guest clients submit one genuinely mailed proof. Keep
    // the original sequential reset/replay and MFA journey above intact.
    const before = await readUser();
    const beforeVersion = before.get("auth_version");
    const beforeMfa = before.get("mfa_secret");
    const beforeMfaEnabled = before.get("mfa_enabled");
    const beforeRecovery = before.get("mfa_recovery_codes");
    cookie = csrf.cookie;
    const unknownEmail = `absent-${crypto.randomUUID()}@example.test`;
    const forgotPath = browser ? "/forgot-password" : "/api/v1/auth/forgot-password";
    const unknownResponse = await status(
      await request(forgotPath, { email: unknownEmail }),
      browser ? 302 : 200,
      "unknown account reset remains neutral",
    );
    assert.equal(await deliveredTo(unknownEmail), 0);
    assert.equal(
      await withModels((User, _tokens) => User.where(userPredicate(unknownEmail)).count()),
      0,
    );
    const knownResponse = await status(
      await request(forgotPath, { email }),
      browser ? 302 : 200,
      "new reset intent for competing clients",
    );
    if (!browser) assert.deepEqual(JSON.parse(unknownResponse), JSON.parse(knownResponse));
    const competingReset = await mailLink("Reset your password");
    assert.notEqual(competingReset, reset, "Each issuance must carry a new proof.");
    const pendingResetProofs = () =>
      withModels((_users, AuthOneTimeToken) =>
        AuthOneTimeToken.where({
          user_id: registered.get("id"),
          purpose: "password_reset",
        })
          .whereNull("consumed_at")
          .count(),
      );
    assert.equal(await pendingResetProofs(), 1);
    // Public transactional publication runs AFTER the actual UPDATE. A separate
    // fault owner avoids requiring unrelated baseline writes to be transactional.
    await closeApplication();
    const resetFailure = new Error("injected post-update reset persistence failure");
    const ResetFault =
      createServiceToken<TransactionalRepositoryListener<UserFields, "id">>("journey.reset-fault");
    let rejectedWrites = 0;
    await bootApplication(
      [
        valueService(ResetFault, async ({ session, row }) => {
          assert.equal(row.id, registered.get("id"));
          const written = await session
            .model<UserFields, "id", Model<UserFields, "id">>(User)
            .where(userPredicate(email))
            .first();
          assert.ok(written);
          assert.equal(
            await Bun.password.verify("Rejected!Password789", written.get("password")),
            true,
          );
          rejectedWrites++;
          throw resetFailure;
        }),
      ],
      [repositoryEffects(UserRepository, [{ action: "updated", transactional: ResetFault }])],
    );
    await status(
      await request(competingReset, { password: "Rejected!Password789", email }),
      500,
      "post-update reset failure must roll back proof consumption",
    );
    assert.equal(rejectedWrites, 1, "The real reset UPDATE must reach transactional publication.");
    const rolledBack = await readUser();
    assert.equal(rolledBack.get("password"), before.get("password"));
    assert.equal(rolledBack.get("auth_version"), beforeVersion);
    assert.equal(rolledBack.get("mfa_secret"), beforeMfa);
    assert.equal(rolledBack.get("mfa_enabled"), beforeMfaEnabled);
    assert.deepEqual(rolledBack.get("mfa_recovery_codes"), beforeRecovery);
    assert.equal(await pendingResetProofs(), 1, "A rejected write must leave its proof usable.");
    await closeApplication();
    await bootApplication();
    const guests = await all([jsonCsrfHeaders(origin), jsonCsrfHeaders(origin)]);
    const passwords = ["Competing!PasswordLeft123", "Competing!PasswordRight456"];
    const responses = await all(
      guests.map((guest, index) => {
        const password = passwords[index];
        assert.ok(password);
        return journeyFetch(origin + competingReset, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
          headers: {
            ...guest.headers,
            accept: browser ? "text/html" : "application/json",
            "content-type": browser ? "application/x-www-form-urlencoded" : "application/json",
          },
          body: browser
            ? new URLSearchParams({ _token: guest.token, password, email })
            : JSON.stringify({ password, email }),
        });
      }),
    );
    const successStatus = browser ? 302 : 200;
    const rejectedStatus = browser ? 200 : 403;
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [successStatus, rejectedStatus].sort(),
      "Exactly one client may consume a reset proof.",
    );
    for (const response of responses) {
      const body = await status(response, response.status, "competing reset response");
      if (response.status === rejectedStatus) assert.match(body, /Invalid or expired reset link/);
      else if (browser) assert.equal(response.headers.get("location"), "/login");
    }
    const winner = responses.findIndex((response) => response.status === successStatus);
    const persisted = await readUser();
    for (const [index, password] of passwords.entries()) {
      assert.equal(
        await Bun.password.verify(password, persisted.get("password")),
        index === winner,
        "Only the successful HTTP result may determine the persisted password.",
      );
    }
    assert.equal(
      persisted.get("auth_version"),
      beforeVersion + 1,
      "One proof advances revocation exactly once.",
    );
    assert.equal(
      persisted.get("mfa_secret"),
      beforeMfa,
      "Password reset must preserve MFA enrollment.",
    );
    assert.deepEqual(persisted.get("mfa_recovery_codes"), beforeRecovery);
    assert.equal(persisted.get("mfa_enabled"), beforeMfaEnabled);
    assert.equal(
      await withModels((_users, AuthOneTimeToken) =>
        AuthOneTimeToken.where({
          user_id: registered.get("id"),
          purpose: "password_reset",
        })
          .whereNull("consumed_at")
          .count(),
      ),
      0,
    );
    await protectedStatus(401);
    cookie = csrf.cookie;
    await status(
      await request(competingReset, { password: replacement, email }),
      rejectedStatus,
      "neither competing client leaves a reusable reset proof",
    );
    assert.equal((await readUser()).get("auth_version"), beforeVersion + 1);
    console.log(
      `PASS ${profile.name}: concurrent reset has one winner, neutral unknown account, persisted password/epoch/proof and MFA preservation`,
    );
  }
  cookie = csrf.cookie;
  const raceEmail = `concurrent-${crypto.randomUUID()}@example.test`;
  const raced = await all([
    request(register, { name: "Concurrent Signup", email: raceEmail, password }),
    request(register, { name: "Concurrent Signup", email: raceEmail, password }),
  ]);
  for (const response of raced)
    await status(response, browser ? 302 : 201, "concurrent signup remains neutral");
  assert.equal(
    await withModels((User, _tokens) => User.where(userPredicate(raceEmail)).count()),
    1,
  );
  assert.equal(await deliveredTo(raceEmail), 1, "Only the winning signup sends verification.");
  // Public transactional publication runs AFTER INSERT/readback, before mail.
  cookie = csrf.cookie;
  const faultEmail = `rollback-${crypto.randomUUID()}@example.test`;
  await closeApplication();
  const tokenFailure = new Error("injected post-insert token persistence failure");
  const TokenFault =
    createServiceToken<TransactionalRepositoryListener<TokenFields, "id">>("journey.token-fault");
  let tokenInsertions = 0;
  let failedTokenId: number | undefined;
  await bootApplication(
    [
      valueService(TokenFault, async ({ session, row }) => {
        const written = await session
          .model<TokenFields, "id", Model<TokenFields, "id">>(AuthOneTimeToken)
          .where({ id: row.id, user_id: row.user_id })
          .first();
        assert.ok(written, "Fault follows a physical token INSERT.");
        const user = await session
          .model<UserFields, "id", Model<UserFields, "id">>(User)
          .where({ ...userPredicate(faultEmail), id: row.user_id })
          .first();
        assert.ok(user, "Inserted proof belongs to the signup in this child.");
        failedTokenId = row.id;
        tokenInsertions++;
        throw tokenFailure;
      }),
    ],
    [
      repositoryEffects(AuthOneTimeTokenRepository, [
        { action: "created", transactional: TokenFault },
      ]),
    ],
  );
  await status(
    await request(register, { name: "Rollback User", email: faultEmail, password }),
    500,
    "injected post-insert token failure",
  );
  assert.equal(tokenInsertions, 1);
  assert.ok(failedTokenId !== undefined);
  assert.equal(
    await withModels((_users, tokens) => tokens.where({ id: failedTokenId }).count()),
    0,
    "Physical token INSERT must roll back.",
  );
  assert.equal(
    await withModels((User, _tokens) => User.where(userPredicate(faultEmail)).count()),
    0,
    "Signup account and token intent must roll back together.",
  );
  assert.equal(await deliveredTo(faultEmail), 0, "Rolled-back signup must not send mail.");
  await closeApplication();
  await bootApplication();
  await status(
    await request(register, { name: "Rollback User", email: faultEmail, password }),
    browser ? 302 : 201,
    "retry after rolled-back signup",
  );
  assert.equal(await deliveredTo(faultEmail), 1);
  if (cookieAuth) {
    const outageEmail = `smtp-outage-${crypto.randomUUID()}@example.test`;
    cookie = csrf.cookie;
    docker(["stop", "--time", "1", container]);
    try {
      await status(
        await request(register, { name: "SMTP Recovery", email: outageEmail, password }),
        500,
        "SMTP outage reported",
      );
      assert.equal(
        await withModels((User, _tokens) => User.where(userPredicate(outageEmail)).count()),
        1,
        "Committed account survives external SMTP failure.",
      );
    } catch (error) {
      const errors = [error];
      try {
        docker(["start", container]);
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
      throwFailures(errors, "SMTP outage witness and restart failed.");
    }
    docker(["start", container]);
    let recovered = false;
    for (let n = 0; n < 100; n++) {
      try {
        recovered = (await journeyFetch(`${mailApi}/readyz`)).ok;
      } catch {}
      if (recovered) break;
      await Bun.sleep(50);
    }
    assert.ok(recovered);
    await status(
      await request(loginPath, { email: outageEmail, password }),
      browser ? 302 : 200,
      "unverified owner can sign in to recover mail",
    );
    await status(
      await request(
        browser ? "/email/verification-notification" : "/api/v1/auth/verification-notification",
        {},
      ),
      browser ? 302 : 200,
      "verification resend after SMTP recovery",
    );
    assert.equal(await deliveredTo(outageEmail), 1);
    if (!browser) {
      await status(await request("/api/v1/auth/mfa"), 403, "unverified owner cannot enroll MFA");
      await status(
        await request("/api/v1/auth/confirm-password", { password }),
        403,
        "unverified owner cannot confirm password",
      );
      cookie = csrf.cookie;
      await status(
        await request("/api/v1/auth/verification-notification", {}),
        401,
        "guest cannot resend verification",
      );
    }
  }
  completedMessage = `PASS ${profile.name}: signup / SMTP verification / tamper / replay / login / SMTP reset / revocation / replacement login / MFA where supported / atomic signup retry`;
} catch (error) {
  failures.push(error);
} finally {
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }
  process.removeListener("SIGTERM", terminate);
  if (termination.signal.aborted && !failures.some((error) => Object.is(error, terminationFailure)))
    failures.push(terminationFailure);
}
throwFailures(failures, "SMTP journey and owned cleanup failed.");
assert.ok(completedMessage);
console.log(completedMessage);
