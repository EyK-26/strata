/** Installed-package SAML ACS + SQL replay acceptance; signed IdP fixtures are independent. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { ExecutionPersistence, SelectedSession } from "@getstrata/core/contracts/persistence";
import type { Model } from "@getstrata/core/database/model";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";
import { mergeCookies } from "../tests/helpers/jsonCsrf.ts";
import { createSignedSamlResponse } from "../tests/helpers/samlFixture.ts";

const engine = process.argv[2];
assert.ok(engine === "postgres" || engine === "sqlite" || engine === "mysql");
const material = await createSignedSamlResponse();
const fixture = await createGeneratedSecurityApp(engine);
const prefix = `saml_${crypto.randomUUID().replaceAll("-", "")}`;
const audience = "https://q01-sp.example.test/metadata";
const issuer = "https://idp.example.test/metadata";
const cwd = process.cwd();
let stop: (() => Promise<void>) | undefined;
const failures: unknown[] = [];
function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
async function availablePort(): Promise<number> {
  const errors: unknown[] = [];
  let probe: ReturnType<typeof Bun.serve> | undefined, port: number | undefined;
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
  throwFailures(errors, "Port probe and cleanup failed.");
  assert.ok(port);
  return port;
}
try {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const destination = `${origin}/auth/saml/acs`;
  Object.assign(process.env, {
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
    APP_ENV: "local",
    APP_DEBUG: "false",
    APP_NAME: "Q01 SAML",
    APP_KEY_PREFIX: prefix,
    APP_URL: origin,
    SAML_ACS_URL: destination,
    FRONTEND_MODE: "server-htmx",
    TENANCY_DRIVER: engine === "postgres" ? "rls" : "column",
    AUTH_DEV_HEADERS: "false",
    SESSION_SECRET: "q01-saml-fixture-session-secret-at-least-32",
    TOKEN_HASH_PEPPER: "q01-saml-pepper",
    JWT_SECRET: "q01-saml-fixture-jwt-secret-at-least-32",
    KMS_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64"),
    FEATURE_OAUTH: "false",
    FEATURE_SAML: "true",
    FEATURE_SCIM: "false",
    FEATURE_MFA: "true",
    FEATURE_REGISTRATION: "true",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    MAIL_DRIVER: "log",
    OAUTH_STATE_SECRET: "q01-saml-fixture-state-secret-at-least-32",
    SAML_IDP_SSO_URL: "https://idp.example.test/sso",
    SAML_IDP_CERT: material.cert,
    SAML_SP_ENTITY_ID: audience,
    SAML_IDP_ISSUER: issuer,
    SAML_WANT_RESPONSE_SIGNED: "true",
  });
  delete process.env.STRATA_SCHEMA;
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
        ...(engine === "mysql"
          ? { DATABASE_URL: fixture.migrationUrl, APP_DATABASE_URL: fixture.migrationUrl }
          : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
      killSignal: "SIGKILL",
    },
  );
  const migrationResults = await Promise.allSettled([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ]);
  throwFailures(
    migrationResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    "Migration child exit/output collection failed.",
  );
  const [migrationExit, migrationOut, migrationErr] = migrationResults;
  if (
    migrationExit?.status !== "fulfilled" ||
    migrationOut?.status !== "fulfilled" ||
    migrationErr?.status !== "fulfilled"
  )
    throw new Error("Migration child channels did not settle successfully.");
  assert.equal(migrationExit.value, 0, `${migrationOut.value}${migrationErr.value}`);
  for (const name of [
    "MIGRATION_DATABASE_URL",
    "MYSQL_OBSERVABILITY_ADMIN_URL",
    "MYSQL_URL",
    "RLS_TEST_DATABASE_URL",
    "POSTGRES_PASSWORD",
    "STRATA_APP_PASSWORD",
  ])
    delete process.env[name];
  const { bootstrapApp } = await import(join(fixture.app, "src/bootstrap/createApp.ts"));
  const boot = await bootstrapApp({
    migrate: false,
    mode: "http",
    server: { port, native: { hostname: "127.0.0.1" } },
  });
  stop = async () =>
    assert.equal(
      (await boot.application.stop({ reason: "SAML acceptance complete" })).successful,
      true,
    );
  assert.ok(boot.server);
  const run = <T>(work: (ports: ExecutionPersistence) => Promise<T>) =>
    boot.invoke(
      { kind: "command", actor: { kind: "system", policy: "fixture.saml-sql-readback" } },
      work,
    );
  async function relay() {
    const start = await fetch(`${origin}/auth/saml`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(start.status, 302);
    const target = new URL(start.headers.get("location") ?? "");
    assert.equal(target.origin + target.pathname, process.env.SAML_IDP_SSO_URL);
    const request = target.searchParams.get("SAMLRequest");
    assert.ok(request);
    const xml = inflateRawSync(Buffer.from(request, "base64")).toString();
    assert.ok(xml.includes(audience));
    assert.ok(xml.includes(destination));
    const state = target.searchParams.get("RelayState");
    assert.ok(state);
    return state;
  }
  const assertion = (options: Parameters<typeof createSignedSamlResponse>[0] = {}) =>
    createSignedSamlResponse({
      audience,
      destination,
      issuer,
      cert: material.cert,
      privateKey: material.privateKey,
      ...options,
    });
  const post = (responseB64: string, state: string) =>
    fetch(destination, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      // IdP-shaped cross-site form POST deliberately has no app cookies/CSRF token.
      headers: {
        origin: "https://idp.example.test",
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ SAMLResponse: responseB64, RelayState: state }),
    });
  async function denied(response: Response, status: number, message: string) {
    assert.equal(response.status, status);
    assert.ok(response.headers.get("content-type")?.includes("application/json"));
    assert.deepEqual(await response.json(), { error: message });
    assert.ok(
      !response.headers.getSetCookie().some((value) => value.startsWith("strata_session=")),
    );
  }
  const assertionId = `q01_${crypto.randomUUID().replaceAll("-", "")}`;
  const signed = await assertion({ email: "DEMO@EXAMPLE.COM", assertionId });
  const state = await relay();
  const login = await post(signed.responseB64, state);
  assert.equal(login.status, 302, await login.text());
  assert.equal(login.headers.get("location"), "/");
  const cookie = mergeCookies(login);
  const me = await fetch(`${origin}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  const user = await me.json();
  assert.ok(user !== null && typeof user === "object" && "email" in user && "id" in user);
  assert.equal(user.email, "demo@example.com");
  // Prove the injected selected SQL store persisted its replay ID.
  const replayCount = () =>
    run(async ({ database }) => {
      const [row] = await database.execute<{ count: number | string }>({
        text: `SELECT COUNT(*) AS count FROM auth_saml_assertions WHERE assertion_id = ${database.dialect.placeholder(1)}`,
        params: [assertionId],
      });
      return Number(row?.count);
    });
  assert.equal(await replayCount(), 1);
  await denied(await post(signed.responseB64, await relay()), 400, "Invalid SAML response.");
  assert.equal(await replayCount(), 1);
  await denied(
    await post((await assertion()).responseB64, "wrong-state"),
    403,
    "Invalid SAML state.",
  );
  for (const options of [
    { signed: false },
    { audience: "https://wrong.example.test" },
    { issuer: "https://wrong.example.test" },
    { destination: `${origin}/wrong-acs` },
    { destination: `${origin}/wrong-response-destination`, recipient: destination },
    { recipient: `${origin}/wrong-recipient` },
  ])
    await denied(
      await post((await assertion(options)).responseB64, await relay()),
      400,
      "Invalid SAML response.",
    );
  const otherMaterial = await createSignedSamlResponse();
  await denied(
    await post(
      (await assertion({ cert: otherMaterial.cert, privateKey: otherMaterial.privateKey }))
        .responseB64,
      await relay(),
    ),
    400,
    "Invalid SAML response.",
  );
  const fresh = await assertion({ email: "New.Saml@Example.Test" });
  const created = await post(fresh.responseB64, await relay());
  assert.equal(created.status, 302);
  const newMe = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { cookie: mergeCookies(created) },
  });
  assert.equal(newMe.status, 200);
  const newUser = await newMe.json();
  assert.ok(
    newUser !== null && typeof newUser === "object" && "email" in newUser && "id" in newUser,
  );
  assert.equal(newUser.email, "new.saml@example.test");
  assert.notEqual(newUser.id, user.id);
  const { User } = await import(join(fixture.app, "src/models/User.ts"));
  const userId = user.id;
  assert.equal(typeof userId, "number");
  if (typeof userId !== "number") throw new Error("Expected persisted numeric user identifier");
  await run(({ database, policy }) => {
    const work = async (selected: SelectedSession) => {
      const users = selected.model<
        { id: number; email: string; mfa_enabled: boolean | number },
        "id",
        Model<{ id: number; email: string; mfa_enabled: boolean | number }, "id">
      >(User);
      assert.equal(await users.where({ email: "new.saml@example.test" }).count(), 1);
      const persisted = await users.find(userId);
      assert.ok(persisted);
      await persisted.update({ mfa_enabled: true });
    };
    return engine === "postgres"
      ? policy.run(database, { kind: "bypass" }, work)
      : database.transaction(work);
  });
  const mfa = await post(
    (await assertion({ email: "demo@example.com" })).responseB64,
    await relay(),
  );
  assert.equal(mfa.status, 302);
  assert.equal(mfa.headers.get("location"), "/login/mfa");
  assert.ok(mfa.headers.getSetCookie().some((value) => value.startsWith("strata_mfa_pending=")));
  const pending = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { cookie: mergeCookies(mfa) },
  });
  assert.equal(pending.status, 401);
  await pending.text();
  for (const flag of ["false", "1", "TRUE"]) {
    process.env.FEATURE_SAML = flag;
    // An admitted app retains its captured true flag; alternate boots capture the disabled value.
    assert.equal((await fetch(`${origin}/auth/saml`, { redirect: "manual" })).status, 302);
    const alternatePort = await availablePort();
    const alternateOrigin = `http://127.0.0.1:${alternatePort}`;
    process.env.APP_URL = alternateOrigin;
    process.env.SAML_ACS_URL = `${alternateOrigin}/auth/saml/acs`;
    const disabled = await bootstrapApp({
      migrate: false,
      mode: "http",
      server: { port: alternatePort, native: { hostname: "127.0.0.1" } },
    });
    const scenarioFailures: unknown[] = [];
    try {
      assert.equal(
        (await fetch(`${alternateOrigin}/auth/saml`, { redirect: "manual" })).status,
        404,
      );
      assert.equal(
        (
          await fetch(`${alternateOrigin}/auth/saml/acs`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ SAMLResponse: signed.responseB64, RelayState: state }),
          })
        ).status,
        404,
      );
    } catch (error) {
      scenarioFailures.push(error);
    }
    try {
      assert.equal(
        (await disabled.application.stop({ reason: "SAML disabled scenario" })).successful,
        true,
      );
    } catch (error) {
      scenarioFailures.push(error);
    }
    throwFailures(scenarioFailures, "Disabled SAML scenario and cleanup failed.");
  }
  const replayProbe = join(fixture.app, "replay-probe.ts");
  await Bun.write(
    replayProbe,
    `import assert from "node:assert/strict";
import {bootstrapApp} from "./src/bootstrap/createApp.ts";
import {createSqlSamlAssertionReplayStore} from "@getstrata/core/auth/saml/samlServiceProvider";
const app=await bootstrapApp({migrate:false,mode:"command"});
let outcome="consumed";const failures:unknown[]=[];
try {
  console.log("SAML_NATIVE_REPLAY_READY");
  assert.equal((await new Response(Bun.stdin.stream()).text()).trim(),"consume");
  try { await app.invoke({kind:"command",actor:{kind:"system",policy:"fixture.saml-native-replay"}},({database})=>createSqlSamlAssertionReplayStore(database).consume(process.argv[2]!)); }
  catch(error) { if(error instanceof Error && error.message==="SAML assertion replay detected.") outcome="replay"; else throw error; }
} catch(error) {failures.push(error);}
try {assert.equal((await app.application.stop({reason:"native replay process complete"})).successful,true);} catch(error) {failures.push(error);}
if(failures.length===1) throw failures[0];
if(failures.length>1) throw new AggregateError(failures,"Replay process and cleanup failed.");
console.log("SAML_NATIVE_REPLAY_RESULT:"+outcome);
`,
  );
  const replayEnvironment = Object.freeze({ ...process.env });
  function probeReplay(id: string) {
    const child = Bun.spawn([process.execPath, replayProbe, id], {
      cwd: fixture.app,
      env: replayEnvironment,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 25000,
      killSignal: "SIGKILL",
    });
    let ready = () => {},
      notReady = (_error: unknown) => {};
    const admitted = new Promise<void>((resolve, reject) => {
      ready = resolve;
      notReady = reject;
    });
    void admitted.catch(() => {});
    const output = (async () => {
      const reader = child.stdout.getReader(),
        decoder = new TextDecoder();
      let stdout = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          stdout += decoder.decode(chunk.value, { stream: true });
          if (stdout.includes("SAML_NATIVE_REPLAY_READY")) ready();
        }
      } finally {
        reader.releaseLock();
      }
      return stdout;
    })();
    const stderrOutput = new Response(child.stderr).text();
    void output.catch(notReady);
    void stderrOutput.catch(notReady);
    const outcome = Promise.allSettled([child.exited, output, stderrOutput]).then((results) => {
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      throwFailures(errors, "Replay child exit/output collection failed.");
      const [exit, stdoutResult, stderrResult] = results;
      assert.equal(exit?.status, "fulfilled");
      assert.equal(stdoutResult?.status, "fulfilled");
      assert.equal(stderrResult?.status, "fulfilled");
      if (
        exit?.status !== "fulfilled" ||
        stdoutResult?.status !== "fulfilled" ||
        stderrResult?.status !== "fulfilled"
      )
        throw new Error("Replay child channels did not settle successfully.");
      assert.equal(exit.value, 0, stderrResult.value);
      const result = /SAML_NATIVE_REPLAY_RESULT:(consumed|replay)/.exec(stdoutResult.value)?.[1];
      assert.ok(result);
      return result;
    });
    void outcome.catch(notReady);
    return {
      ready: admitted,
      outcome,
      start() {
        child.stdin.write("consume\n");
        child.stdin.end();
      },
      abort() {
        child.kill("SIGKILL");
      },
    };
  }
  async function replayGroup(id: string, count: number) {
    const children: ReturnType<typeof probeReplay>[] = [];
    const errors: unknown[] = [];
    try {
      for (let index = 0; index < count; index++) children.push(probeReplay(id));
      await Promise.all(children.map((child) => child.ready));
      for (const child of children) child.start();
    } catch (error) {
      errors.push(error);
      for (const child of children)
        try {
          child.abort();
        } catch (abortError) {
          errors.push(abortError);
        }
    }
    const settled = await Promise.allSettled(children.map((child) => child.outcome));
    for (const result of settled)
      if (result.status === "rejected" && !errors.includes(result.reason))
        errors.push(result.reason);
    throwFailures(errors, "Replay process failure and complete child settlement.");
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }
  const racedId = `race_${crypto.randomUUID().replaceAll("-", "")}`;
  assert.deepEqual((await replayGroup(racedId, 2)).sort(), ["consumed", "replay"]);
  assert.deepEqual(await replayGroup(racedId, 1), ["replay"]);
  await run(async ({ database }) => {
    const [row] = await database.execute<{ count: number | string }>({
      text: `SELECT COUNT(*) AS count FROM auth_saml_assertions WHERE assertion_id = ${database.dialect.placeholder(1)}`,
      params: [racedId],
    });
    assert.equal(Number(row?.count), 1);
  });
} catch (error) {
  failures.push(error);
} finally {
  try {
    await stop?.();
  } catch (error) {
    failures.push(error);
  }
  try {
    process.chdir(cwd);
  } catch (error) {
    failures.push(error);
  }
  try {
    await fixture.close();
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1) throw new AggregateError(failures, "SAML acceptance and cleanup failed.");
console.log(
  `Packed ${engine} SAML passed: signed cross-site ACS, persisted sessions/JIT/SQL replay, MFA, rejected response/state and feature gates.`,
);
