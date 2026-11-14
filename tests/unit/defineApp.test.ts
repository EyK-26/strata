import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Application } from "@getstrata/core/contracts/application";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { defineProvider } from "@getstrata/core/runtime/application";
import {
  type AppDefinition,
  type ApplicationAuthServices,
  defineApp,
} from "../../src/bootstrap/application";

const roots: string[] = [];
const owners: Application[] = [];
const original = { ...process.env };
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.stop({ reason: "TEST_DONE" });
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});
async function fixture(overrides: Partial<AppDefinition<ApplicationAuthServices>> = {}) {
  const root = await mkdtemp(join(tmpdir(), "strata-app-definition-"));
  roots.push(root);
  for (const key of [
    "APP_DATABASE_URL",
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "FRONTEND_MODE",
    "TENANCY_DRIVER",
    "REDIS_URL",
  ])
    delete process.env[key];
  Object.assign(process.env, {
    APP_ENV: "development",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    SESSION_SECRET: "test-application-secret-of-sufficient-length",
    SIGNED_URL_SECRET: "test-application-signed-secret-of-sufficient-length",
    APP_URL: "http://localhost:3000",
  });
  const definition: AppDefinition<ApplicationAuthServices> = {
    root,
    database: () => ({ driver: "sqlite", filename: join(root, "database.sqlite") }),
    models: [],
    repositories: [],
    migrate: async () => {},
    outbox: { listeners: [] },
    tenancy: "none",
    frontend: "api",
    defaults: { DATABASE_URL: "sqlite:database.sqlite" },
    auth: {
      token: createServiceToken<ApplicationAuthServices>("test.auth"),
      create: () => ({
        metadata: () => ({
          authenticate: async () =>
            ({ status: "absent", user: null, credentialSource: null }) as const,
          memberships: async () => [],
          userTenantId: async () => 1,
          tenant: async () => null,
        }),
        config: {
          signatureSecret: "test-secret",
          sessionCookie: { cookieName: "test_session", production: false },
          passwordConfirmation: {
            secret: "test-secret",
            cookieName: "test_confirm",
            ttlSeconds: 60,
          },
        },
      }),
    },
    ...overrides,
  };
  return { root, definition, app: defineApp(definition) };
}

test("application captures configuration before asynchronous provisioning and honors its module directory", async () => {
  const { root, definition } = await fixture();
  await mkdir(join(root, "domain/probe"), { recursive: true });
  await writeFile(
    join(root, "domain/probe/index.ts"),
    'export default {name:"probe",webRoutes:()=>({"/document":()=>new Response("document")}),routes:()=>({"/probe":()=>new Response("probe")})};',
  );
  let snapshot: Readonly<Record<string, string | undefined>> | undefined;
  let selected: Readonly<Record<string, string | undefined>> | undefined;
  const { bootstrapApp } = defineApp({
    ...definition,
    frontend: "hybrid",
    modulesDirectory: "domain",
    defaults: { ...definition.defaults, FRONTEND_MODE: "hybrid", SPA_PREFIX: "/portal" },
    ensureDatabase: async (options) => {
      snapshot = options.environment;
      process.env.FRONTEND_MODE = "api";
      process.env.SPA_PREFIX = "/changed";
      process.env.DATABASE_URL = "wrong";
    },
    migrate: async (env) => {
      expect(env).toBe(snapshot);
    },
    database: (env) => {
      selected = env;
      return definition.database(env);
    },
  });
  const boot = await bootstrapApp({
    onConstructed: (owner) => {
      owners.push(owner);
    },
  });
  expect(selected).toBe(snapshot);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(boot.config.databaseUrl).toBe("sqlite:database.sqlite");
  expect(Object.keys(boot.routes)).toEqual(
    expect.arrayContaining(["/portal", "/document", "/probe"]),
  );
  expect(boot.routes["/changed"]).toBeUndefined();
  expect(Object.keys(boot.queue)).toEqual(["dispatch"]);
  expect(
    (
      await boot.invoke(
        { kind: "command", actor: { kind: "system", policy: "test" } },
        async ({ database }) =>
          database.execute<{ value: number }>({ text: "SELECT 7 AS value", params: [] }),
      )
    )[0]?.value,
  ).toBe(7);
  expect((await boot.application.stop({ reason: "TEST_DONE" })).successful).toBe(true);
});

test("invalid deployment choices fail before provisioning", async () => {
  let provisions = 0;
  const { app } = await fixture({
    ensureDatabase: async () => {
      provisions++;
    },
  });
  process.env.TENANCY_DRIVER = "rls";
  await expect(app.createApp()).rejects.toThrow("schema tenancy");
  delete process.env.TENANCY_DRIVER;
  process.env.FRONTEND_MODE = "unsupported";
  await expect(app.createApp()).rejects.toThrow("FRONTEND_MODE");
  expect(provisions).toBe(0);
});

test("canonical provider boot completes before application route factories", async () => {
  let ready = false;
  const { app } = await fixture({
    providers: [
      defineProvider({
        name: "test.ready",
        boot() {
          ready = true;
        },
      }),
    ],
    routes() {
      expect(ready).toBe(true);
      return {};
    },
  });
  const boot = await app.createApp({
    onConstructed: (owner) => {
      owners.push(owner);
    },
  });
  expect(ready).toBe(true);
  await boot.application.stop({ reason: "TEST_DONE" });
});

test("native HTTP owns health/metrics, public routes and cleanup independently of ambient env", async () => {
  let healthy = true;
  const { root, definition } = await fixture({
    metrics: true,
    scim: true,
    health: async () => {
      if (!healthy) throw new Error("schema missing");
      return true;
    },
  });
  await mkdir(join(root, "src/modules/probe"), { recursive: true });
  await writeFile(
    join(root, "src/modules/probe/index.ts"),
    `export default {name:"probe",policies:{probe:{view:()=>true,create:()=>false,update:()=>false,delete:()=>false}},providers:[{name:"probe.provider",register(){}}]};`,
  );
  const outboxToken =
    createServiceToken<
      Readonly<Pick<import("@getstrata/core/events/outbox").SqlOutbox, "publish">>
    >("test.outbox");
  const app = defineApp({ ...definition, outbox: { listeners: [], token: outboxToken } });
  const boot = await app.createAppServer({
    server: { port: 0, native: { hostname: "127.0.0.1" } },
    runtimeMetrics: { failedJobs: {}, outbox: {} },
    onConstructed: (owner) => {
      owners.push(owner);
    },
  });
  expect(boot.context.container.resolve(outboxToken)).toBe(boot.outbox);
  const url = boot.server!.url;
  expect(await (await fetch(new URL("/health", url))).text()).toBe("ok");
  healthy = false;
  expect((await fetch(new URL("/health", url))).status).toBe(503);
  process.env.METRICS_TOKEN = "different-after-start";
  expect((await fetch(new URL("/metrics", url))).status).toBe(200);
  expect((await boot.application.stop({ reason: "TEST_DONE" })).successful).toBe(true);
  await expect(fetch(new URL("/health", url))).rejects.toBeDefined();
});

test("outbox worker acquires and releases its polling resource", async () => {
  const { app, definition } = await fixture();
  const { withMigrationDatabase } = await import("../../src/bootstrap/databaseCommands");
  const { createOutboxMigration } = await import("@getstrata/core/events/outbox");
  await withMigrationDatabase(definition.database({}), (db) =>
    createOutboxMigration("test", "sqlite").up(db),
  );
  const boot = await app.bootstrapApp({
    mode: "outbox-worker",
    onConstructed: (owner) => {
      owners.push(owner);
    },
  });
  expect(boot.outboxWorker).toBeDefined();
  const polling = boot.outboxWorker.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await expect(
    boot.invoke(
      { kind: "command", actor: { kind: "system", policy: "outbox-test" } },
      ({ database }) =>
        database.transaction((tx) => boot.outbox.publish(tx, "undeclared", {}, { tenantId: null })),
    ),
  ).rejects.toThrow();
  expect((await boot.application.stop({ reason: "TEST_DONE" })).successful).toBe(true);
  await polling;
});

test("invalid config and missing worker transport reject before schema side effects", async () => {
  let schemaChanges = 0;
  const { app } = await fixture({
    ensureDatabase: async () => {
      schemaChanges++;
    },
    migrate: async () => {
      schemaChanges++;
    },
  });
  process.env.PORT = "123garbage";
  await expect(app.bootstrapApp()).rejects.toThrow();
  process.env.PORT = "3000";
  await expect(app.bootstrapApp({ mode: "worker" })).rejects.toThrow("REDIS_URL");
  expect(schemaChanges).toBe(0);
});

test("production entrypoint snapshots host policy and drains HTTP on its installed signal", async () => {
  const { serveApplication } = await import("../../src/bootstrap/application");
  const { HTTP_PERSISTENCE_OPTIONS } = await import("../../src/bootstrap/httpPersistence");
  const { app } = await fixture({ metrics: true });
  Object.assign(process.env, {
    APP_ENV: "production",
    APP_URL: "https://app.example.test",
    DATABASE_URL: "sqlite:production.sqlite",
    APP_DEBUG: "false",
    AUTH_DEV_HEADERS: "false",
    TENANT_DEV_HEADERS: "false",
    // CI enables SCIM for the shared fixture; this app has no SCIM integration or token.
    FEATURE_SCIM: "false",
    CSRF_TARGET_ORIGIN: "https://app.example.test",
  });
  for (const key of [
    "ADMIN_API_TOKEN",
    "MEMBER_API_TOKEN",
    "SCIM_BEARER_TOKEN",
    "TOKEN_HASH_PEPPER",
    "JWT_SECRET",
    "OAUTH_STATE_SECRET",
    "KMS_ENCRYPTION_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "METRICS_TOKEN",
  ])
    delete process.env[key];
  const originalExit = process.exit;
  const signals = ["SIGINT", "SIGTERM"] as const;
  const previous = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  let exited!: (code: number) => void;
  const exitCode = new Promise<number>((resolve) => {
    exited = resolve;
  });
  process.exit = ((code?: number | string | null) => {
    exited(Number(code));
    return undefined as never;
  }) as typeof process.exit;
  try {
    const boot = await serveApplication(() =>
      app.createAppServer({
        server: { port: 0, native: { hostname: "127.0.0.1" } },
        onConstructed: (owner) => {
          owners.push(owner);
        },
      }),
    );
    const options = boot.context.container.resolve(HTTP_PERSISTENCE_OPTIONS);
    process.env.APP_URL = "http://changed.example";
    expect(await options.publicTenancy!.resolveTenantId("app.example.test")).toBe(1);
    expect(await options.publicTenancy!.resolveTenantId("changed.example")).toBeNull();
    const listener = process
      .listeners("SIGTERM")
      .find((item) => ![...previous.get("SIGTERM")!].some((old) => old === item));
    expect(listener).toBeDefined();
    listener!("SIGTERM");
    expect(await exitCode).toBe(0);
    expect((await boot.application.completion).successful).toBe(true);
  } finally {
    process.exit = originalExit;
    for (const signal of signals)
      for (const listener of process.listeners(signal))
        if (!previous.get(signal)!.has(listener)) process.off(signal, listener);
  }
});

test("entrypoint rejects non-HTTP startup after closing its owner", async () => {
  const { serveApplication } = await import("../../src/bootstrap/application");
  const { app } = await fixture();
  let owner: Application | undefined;
  await expect(
    serveApplication(() =>
      app.createApp({
        onConstructed: (value) => {
          owner = value;
          owners.push(value);
        },
      }),
    ),
  ).rejects.toThrow("HTTP transport did not start");
  expect((await owner!.completion).successful).toBe(true);
});

test("worker composition owns its configured Redis transport", async () => {
  const { app } = await fixture();
  process.env.REDIS_URL = original.REDIS_URL ?? "redis://redis:6379";
  const boot = await app.bootstrapApp({
    mode: "worker",
    onConstructed: (owner) => {
      owners.push(owner);
    },
  });
  expect(boot.worker).toBeDefined();
  expect((await boot.application.stop({ reason: "TEST_DONE" })).successful).toBe(true);
});

test("a consumer binding failure after startup still closes every application resource", async () => {
  const { root, app } = await fixture();
  await mkdir(join(root, "src/modules/failure"), { recursive: true });
  await writeFile(
    join(root, "src/modules/failure/index.ts"),
    `import {CORE_QUEUE_TOKEN} from ${JSON.stringify(join(process.cwd(), "src/core/contracts/serviceTokens.ts"))};\nexport default {name:"failure",providers:[{name:"failure.provider",register({container}){container.bind(CORE_QUEUE_TOKEN,()=>{throw new Error("consumer binding failed");});}}]};`,
  );
  let started = false;
  let stopped = false;
  let owner: Application | undefined;
  await expect(
    app.createApp({
      onConstructed: (value) => {
        owner = value;
        owners.push(value);
      },
      transports: [
        {
          name: "test.transport",
          async setup(scope) {
            started = true;
            await scope.acquire({
              name: "test.resource",
              open: () => ({ ok: true, value: {} }),
              close() {
                stopped = true;
              },
            });
          },
        },
      ],
    }),
  ).rejects.toThrow("consumer binding failed");
  expect(started).toBe(true);
  expect(stopped).toBe(true);
  expect((await owner!.completion).successful).toBe(true);
});
