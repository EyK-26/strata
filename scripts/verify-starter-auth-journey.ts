/** External installed app, actual HTTP/CSRF and SMTP through an owned Mailpit.
 * Use --published=VERSION and STARTER_JOURNEY_PARENT to qualify registry output. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";
import { jsonCsrfHeaders, mergeCookies } from "../tests/helpers/jsonCsrf";
import { starterJourneyProfiles } from "../tests/helpers/starterJourneyProfiles";

const selectedProfile = starterJourneyProfiles.find((item) => item.name === process.argv[2]);
assert.ok(selectedProfile, "Choose a registered starter journey profile.");
const profile = selectedProfile;
const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.split("=")[1];
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
let mailCreated = false;
let stop: (() => Promise<void>) | undefined;
const cwd = process.cwd();
function docker(args: string[]) {
  const result = Bun.spawnSync(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
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
    process.chdir(cwd);
    try {
      await stop?.();
    } finally {
      try {
        await fixture.close();
      } finally {
        if (mailCreated) docker(["rm", "--force", container]);
      }
    }
  })();
  return cleanupPromise;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
try {
  // Docker can allocate different ephemeral host ports after stop/start. Reserve
  // two owned port numbers and publish them explicitly so outage recovery tests
  // the same configured SMTP endpoint rather than a fixture address change.
  const smtpReservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const httpReservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const smtpPort = smtpReservation.port,
    httpPort = httpReservation.port;
  await smtpReservation.stop(true);
  await httpReservation.stop(true);
  docker([
    "run",
    "--detach",
    "--name",
    container,
    "--publish",
    `127.0.0.1:${smtpPort}:1025`,
    "--publish",
    `127.0.0.1:${httpPort}:8025`,
    "axllent/mailpit@sha256:b68349e3a014b90c5610bfb26b2ae36f3892d7b8cf25ee140c6c71c98d2fcf48",
  ]);
  mailCreated = true;
  const bindings = JSON.parse(
    docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", container]),
  );
  const mailApi = `http://127.0.0.1:${bindings["8025/tcp"][0].HostPort}`;
  const mailPort = bindings["1025/tcp"][0].HostPort;
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      ready = (await fetch(`${mailApi}/readyz`)).ok;
    } catch {}
    if (ready) break;
    await Bun.sleep(50);
  }
  assert.ok(ready, "Owned Mailpit must become ready.");
  Object.assign(process.env, {
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
    DB_CONNECTION: profile.database === "postgres" ? "pgsql" : profile.database,
    APP_ENV: "local",
    APP_DEBUG: "false",
    APP_URL: "http://localhost:3000",
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
  const [code, out, err] = await Promise.all([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ]);
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
  const database = await import(join(fixture.app, "src/bootstrap/database.ts"));
  stop = () => database.closeDatabase();
  const { bootstrapApp, createAppServer } = await import(
    join(fixture.app, "src/bootstrap/createApp.ts")
  );
  const { context, routes } = await bootstrapApp({ migrate: false });
  if (profile.frontend === "api") {
    const apiDocs = await readFile(join(fixture.app, "docs/API.md"), "utf8");
    for (const row of apiDocs.matchAll(/\| `(GET|POST)` \| `([^`]+)`/g)) {
      const path = row[2];
      assert.ok(path && path in routes, `Generated docs advertise absent route ${path}.`);
    }
  }
  const server = createAppServer(routes, 0, undefined, { hostname: "127.0.0.1" });
  stop = async () => {
    await server.stop(true);
    try {
      await context.dispose();
    } finally {
      await database.closeDatabase();
    }
  };
  const { User } = await import(join(fixture.app, "src/models/User.ts"));
  const { AuthOneTimeToken } = await import(join(fixture.app, "src/models/AuthOneTimeToken.ts"));
  const { runWithMigrationBypass } = await import(
    fixture.resolve("@getstrata/core/tenant/databaseTenantContext")
  );
  const { generateTotp } = await import(fixture.resolve("@getstrata/core/security/totp"));
  const origin = server.url.origin;
  process.env.APP_URL = origin;
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
    const response = await fetch(`${origin}${path}`, {
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
    const list = (await (await fetch(`${mailApi}/api/v1/messages`)).json()) as {
      messages: { ID: string; Subject: string; To: { Address: string }[] }[];
    };
    const message = list.messages.find(
      (item: { Subject: string; To: { Address: string }[] }) =>
        item.Subject === subject && item.To.some((to) => to.Address === email),
    );
    assert.ok(message, `Actual SMTP must deliver ${subject} to this owned recipient.`);
    const full = (await (await fetch(`${mailApi}/api/v1/message/${message.ID}`)).json()) as {
      Text: string;
    };
    const link = String(full.Text).match(/https?:\/\/[^\s]+/)?.[0];
    assert.ok(link, "SMTP message must carry a signed actionable link.");
    const url = new URL(link);
    assert.equal(url.origin, origin);
    return `${url.pathname}${url.search}`;
  }
  async function deliveredTo(recipient: string) {
    const list = (await (await fetch(`${mailApi}/api/v1/messages`)).json()) as {
      messages: { To: { Address: string }[] }[];
    };
    return list.messages.filter((item) => item.To.some((to) => to.Address === recipient)).length;
  }
  const register = browser ? "/register" : "/api/v1/auth/register";
  const payload = { name: "New Starter User", email, password };
  const denied = await fetch(`${origin}${register}`, {
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
  const readUser = () => runWithMigrationBypass(() => User.where({ email }).first());
  const registered = await readUser();
  assert.ok(registered);
  assert.equal(await Bun.password.verify(password, registered.get("password")), true);
  assert.equal(registered.get("email_verified_at"), null);
  assert.equal(await runWithMigrationBypass(() => User.where({ email }).count()), 1);
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
    await runWithMigrationBypass(() =>
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
    const response = await fetch(origin + protectedPath, {
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
    const fenced = await fetch(`${origin}/api/v1/auth/me`, {
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
      await fetch(`${origin}/api/v1/auth/mfa`, {
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
  cookie = csrf.cookie;
  const raceEmail = `concurrent-${crypto.randomUUID()}@example.test`;
  const raced = await Promise.all([
    request(register, { name: "Concurrent Signup", email: raceEmail, password }),
    request(register, { name: "Concurrent Signup", email: raceEmail, password }),
  ]);
  for (const response of raced)
    await status(response, browser ? 302 : 201, "concurrent signup remains neutral");
  assert.equal(await runWithMigrationBypass(() => User.where({ email: raceEmail }).count()), 1);
  assert.equal(await deliveredTo(raceEmail), 1, "Only the winning signup sends verification.");
  // Immediate token observer failure models a failed persistence step. A signup
  // must not strand a user without its verification intent or send rolled-back mail.
  cookie = csrf.cookie;
  const faultEmail = `rollback-${crypto.randomUUID()}@example.test`;
  let rejectToken = true;
  AuthOneTimeToken.observe({
    creating() {
      if (rejectToken) throw new Error("injected token persistence failure");
    },
  });
  try {
    await status(
      await request(register, { name: "Rollback User", email: faultEmail, password }),
      500,
      "injected token failure",
    );
  } finally {
    rejectToken = false;
  }
  assert.equal(
    await runWithMigrationBypass(() => User.where({ email: faultEmail }).count()),
    0,
    "Signup account and token intent must roll back together.",
  );
  assert.equal(await deliveredTo(faultEmail), 0, "Rolled-back signup must not send mail.");
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
        await runWithMigrationBypass(() => User.where({ email: outageEmail }).count()),
        1,
        "Committed account survives external SMTP failure.",
      );
    } finally {
      docker(["start", container]);
    }
    let recovered = false;
    for (let n = 0; n < 100; n++) {
      try {
        recovered = (await fetch(`${mailApi}/readyz`)).ok;
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
  console.log(
    `PASS ${profile.name}: signup / SMTP verification / tamper / replay / login / SMTP reset / revocation / replacement login / MFA where supported / atomic signup retry`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
