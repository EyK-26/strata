import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplicationContext } from "@getstrata/bootstrap/context";
import type { ProviderContext } from "@getstrata/bootstrap/contracts";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { APPLICATION_EVENT_BUS_TOKEN } from "@getstrata/bootstrap/providers/events";
import { runWithEstablishedAuth } from "@getstrata/core/auth/authReader";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import {
  CORE_PUBLIC_TENANCY_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { Job } from "@getstrata/core/queue";
import { QUEUE_JOB_REGISTRY_TOKEN } from "@getstrata/core/queue/jobRegistry";
import { createApplication, defineProvider } from "@getstrata/core/runtime/application";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/testing";
import { CORE_VIEW_TOKEN } from "@getstrata/core/view/tokens";
import type { AppDefinition, ApplicationAuthServices } from "../../src/bootstrap/application";
import { loadApplicationConfig } from "../../src/bootstrap/application/config";
import {
  APPLICATION_AUDIT_EXPORT,
  APPLICATION_BILLING,
  APPLICATION_CACHE,
  APPLICATION_QUEUE,
  APPLICATION_QUEUE_SERVICES,
  APPLICATION_STORAGE,
  createApplicationProviders,
  createApplicationServices,
  createConfigProvider,
} from "../../src/bootstrap/application/services";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { createQueuePersistenceFixture } from "../helpers/queuePersistence";

const unusedInvoke: PersistenceInvocation = async () => {
  throw new Error("No persistence work expected.");
};

for (const storagePath of [undefined, "files", "absolute"] as const) {
  test(`application local storage anchors ${storagePath ?? "default"} paths to the selected root`, async () => {
    const root = await mkdtemp(join(tmpdir(), "strata-service-path-"));
    const other = await mkdtemp(join(tmpdir(), "strata-storage-absolute-"));
    const env: Record<string, string | undefined> = {
      QUEUE_DRIVER: "sync",
      CACHE_DRIVER: "array",
      ...(storagePath ? { STORAGE_PATH: storagePath === "absolute" ? other : storagePath } : {}),
    };
    const services = createApplicationServices(env, unusedInvoke, root);
    env.STORAGE_PATH = "changed-after-assembly";
    const app = createApplication({
      services,
      providers: [
        defineProvider({
          name: "fixture.storage",
          async setup(scope) {
            await scope.resolve(APPLICATION_STORAGE).put("example.txt", "owned");
          },
        }),
      ],
    });
    try {
      await app.start();
      const directory = storagePath === "absolute" ? other : join(root, storagePath ?? "storage");
      expect(await readFile(join(directory, "example.txt"), "utf8")).toBe("owned");
    } finally {
      expect((await app.stop()).successful).toBe(true);
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(other, { recursive: true, force: true }),
      ]);
    }
  });
}

test("application dispatch facade keeps captured retries and remains closed after owner shutdown", async () => {
  const fixture = await createQueuePersistenceFixture();
  const root = await mkdtemp(join(tmpdir(), "strata-queue-services-"));
  const env: Record<string, string | undefined> = {
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    QUEUE_MAX_ATTEMPTS: "3",
    QUEUE_BACKOFF_MS: "0",
  };
  const services = createApplicationServices(
    env,
    createPersistenceInvocation(fixture.application, "test"),
    root,
  );
  env.QUEUE_MAX_ATTEMPTS = "1";
  env.QUEUE_DRIVER = "unsupported";
  let attempts = 0;
  class Retry extends Job {
    static override readonly jobName = "fixture.application.retry";
    async handle() {
      if (++attempts < 3) throw new Error("transient");
    }
  }
  let dispatch: (() => Promise<void>) | undefined;
  const app = createApplication({
    services,
    providers: [
      defineProvider({
        name: "fixture.queue",
        setup(scope) {
          scope.resolve(QUEUE_JOB_REGISTRY_TOKEN).register(Retry.jobName, () => new Retry());
          const consumer = scope.resolve(CORE_QUEUE_TOKEN);
          expect(Object.keys(consumer)).toEqual(["dispatch"]);
          expect(Object.isFrozen(consumer)).toBe(true);
          dispatch = () => consumer.dispatch(new Retry(), {});
        },
      }),
    ],
  });
  try {
    await app.start();
    if (!dispatch) throw new Error("Dispatch capability was not assembled.");
    await dispatch();
    expect(attempts).toBe(3);
    expect((await app.stop()).successful).toBe(true);
    await expect(dispatch()).rejects.toThrow("closed");
    expect(attempts).toBe(3);
  } finally {
    await app.stop();
    expect((await fixture.application.stop()).successful).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
});

const auth: ApplicationAuthServices = {
  metadata() {
    throw new Error("No HTTP work expected.");
  },
  config: {
    signatureSecret: "fixture-signature-secret",
    sessionCookie: { cookieName: "fixture_session", production: false },
    passwordConfirmation: {
      secret: "fixture-password-secret",
      cookieName: "fixture_password",
      ttlSeconds: 60,
    },
  },
};
function definition(root: string): AppDefinition<ApplicationAuthServices> {
  return {
    root,
    database: () => ({ driver: "sqlite", filename: ":memory:" }),
    auth: { create: () => auth, token: createServiceToken("fixture.auth.services") },
    models: [],
    repositories: [],
    async migrate() {},
    routes: () => ({}),
    outbox: { listeners: [] },
    tenancy: "none",
    frontend: "api",
    views: false,
  };
}

test("application providers use captured frontend, config, root and dispatch capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "strata-provider-services-"));
  const env: Record<string, string | undefined> = {
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    FRONTEND_MODE: "server-htmx",
    APP_NAME: "Captured",
    SESSION_SECRET: "fixture-secret-012345678901234567890123456789",
  };
  const appConfig = {
    port: 1234,
    appUrl: "https://fixture.example",
    databaseUrl: "sqlite://captured",
  };
  const handle = createApplicationContext([], {
    connection: "main",
    definition: { providers: [], services: createApplicationServices(env, unusedInvoke, root) },
    providersFromScope(scope) {
      const providers = createApplicationProviders(
        definition(root),
        env,
        auth,
        scope.resolve(APPLICATION_CACHE),
        scope.resolve(APPLICATION_QUEUE),
        scope.resolve(APPLICATION_QUEUE_SERVICES),
        scope.resolve(APPLICATION_EVENT_BUS_TOKEN),
        scope.resolve(APPLICATION_BILLING),
        scope.resolve(APPLICATION_STORAGE),
        scope.resolve(QUEUE_JOB_REGISTRY_TOKEN),
        appConfig,
      );
      env.FRONTEND_MODE = "api";
      env.APP_NAME = "Changed";
      appConfig.port = 9999;
      appConfig.appUrl = "https://changed.example";
      return providers;
    },
  });
  try {
    const context = await handle.start();
    expect(context.config.get("app.port")).toBe(1234);
    expect(context.config.get("app.url")).toBe("https://fixture.example");
    expect(context.config.get("view.directory")).toBe(join(root, "views"));
    expect(context.container.has(CORE_VIEW_TOKEN)).toBe(true);
    expect(Object.keys(context.container.resolve(CORE_QUEUE_TOKEN))).toEqual(["dispatch"]);
    const rendered = context.container.resolve(CORE_VIEW_TOKEN);
    expect(rendered).toBeDefined();
  } finally {
    expect((await handle.application.stop()).successful).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("async queue resource drains admitted jobs before its application finishes shutdown", async () => {
  const fixture = await createQueuePersistenceFixture();
  const root = await mkdtemp(join(tmpdir(), "strata-async-services-"));
  let enter: () => void = () => {};
  let release: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  class Pending extends Job {
    static override readonly jobName = "fixture.application.pending";
    async handle() {
      enter();
      await blocked;
    }
  }
  let dispatch: (() => Promise<void>) | undefined;
  const env = { CACHE_DRIVER: "array", QUEUE_DRIVER: "async", QUEUE_MAX_ATTEMPTS: "1" };
  const services = createApplicationServices(
    env,
    createPersistenceInvocation(fixture.application, "test"),
    root,
  );
  env.QUEUE_DRIVER = "sync";
  const app = createApplication({
    services,
    providers: [
      defineProvider({
        name: "fixture.async.queue",
        setup(scope) {
          scope.resolve(QUEUE_JOB_REGISTRY_TOKEN).register(Pending.jobName, () => new Pending());
          const queue = scope.resolve(CORE_QUEUE_TOKEN);
          dispatch = () => queue.dispatch(new Pending(), {});
        },
      }),
    ],
  });
  try {
    await app.start();
    if (!dispatch) throw new Error("Dispatch capability was not assembled.");
    await dispatch();
    await entered;
    let stopped = false;
    const stopping = app.stop().then((result) => {
      stopped = true;
      return result;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    expect((await stopping).successful).toBe(true);
    await expect(dispatch()).rejects.toThrow("closed");
  } finally {
    release();
    await app.stop();
    expect((await fixture.application.stop()).successful).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid queue configuration is rejected before any application resources open", () => {
  expect(() =>
    createApplicationServices({ QUEUE_DRIVER: "unknown" }, unusedInvoke, "/tmp"),
  ).toThrow("Unknown queue driver");
});

for (const appUrl of [
  "ftp://fixture.example",
  "https://user:password@fixture.example",
  "not a URL",
]) {
  test(`application config rejects unsafe APP_URL ${appUrl}`, () => {
    expect(() =>
      loadApplicationConfig({ DATABASE_URL: "sqlite://fixture", APP_URL: appUrl }),
    ).toThrow();
  });
}

function providerContext(): ProviderContext {
  const container = new ServiceContainer();
  return {
    container,
    config: new ConfigStore(),
    dependencies: { container, invoke: unusedInvoke },
    invoke: unusedInvoke,
    onCleanup() {},
  };
}

test("production config snapshots normalized public host and explicitly configured CSRF target", async () => {
  const env = { APP_ENV: "production", CSRF_TARGET_ORIGIN: "https://captured.example" };
  const config = {
    port: 8080,
    appUrl: "https://Fixture.Example:8443",
    databaseUrl: "sqlite://captured",
  };
  const provider = createConfigProvider(config, env);
  env.CSRF_TARGET_ORIGIN = "https://changed.example";
  config.appUrl = "https://changed.example";
  const context = providerContext();
  await provider.register?.(context);
  const tenancy = context.container.resolve(CORE_PUBLIC_TENANCY_TOKEN);
  expect(await tenancy.resolveTenantId("fixture.example")).toBe(1);
  expect(await tenancy.resolveTenantId("changed.example")).toBeNull();
  expect(context.config.get("http.csrf.targetOrigin")).toBe("https://captured.example");
  expect(context.config.get("app.url")).toBe("https://Fixture.Example:8443");
});

test("production config refuses malformed public tenant hosts", async () => {
  const provider = createConfigProvider(
    { port: 8080, appUrl: "https://bad_host.example", databaseUrl: "sqlite://fixture" },
    { APP_ENV: "production" },
  );
  await expect(
    Promise.resolve().then(() => provider.register?.(providerContext())),
  ).rejects.toThrow("Invalid tenant hostname");
});

for (const tenancy of ["none", "rls"] as const) {
  test(`application audit exporter owns SQL and enforces ${tenancy} policy`, async () => {
    const fixture = await createQueuePersistenceFixture();
    const root = await mkdtemp(join(tmpdir(), "strata-audit-services-"));
    await fixture.run((db) =>
      db.execute({
        text: `CREATE TABLE audit_log(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,subject_type TEXT,subject_id INTEGER,payload TEXT,ip_address TEXT,user_agent TEXT,checksum TEXT,tenant_id INTEGER,trace_id TEXT,created_at TEXT,exported_at TEXT)`,
        params: [],
      }),
    );
    await fixture.run((db) =>
      db.execute({
        text: `INSERT INTO audit_log(id,action,subject_type,payload,created_at) VALUES(1,'created','note','{}','2026-01-01T00:00:00Z')`,
        params: [],
      }),
    );
    const originalFetch = globalThis.fetch;
    const outgoing: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      outgoing.push(String(init?.body));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    setDnsLookupForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    let exportLogs: (() => Promise<number>) | undefined;
    const app = createApplication({
      services: createApplicationServices(
        {
          CACHE_DRIVER: "array",
          QUEUE_DRIVER: "sync",
          TENANCY_DRIVER: tenancy,
          SIEM_EXPORT_URL: "https://audit.example/ingest",
        },
        createPersistenceInvocation(fixture.application, "test"),
        root,
      ),
      providers: [
        defineProvider({
          name: "fixture.audit",
          setup(scope) {
            exportLogs = scope.resolve(APPLICATION_AUDIT_EXPORT);
          },
        }),
      ],
    });
    try {
      await app.start();
      if (!exportLogs) throw new Error("Audit exporter was not assembled.");
      if (tenancy === "rls") {
        await expect(exportLogs()).rejects.toThrow("RLS tenant scope requires PostgreSQL");
        expect(outgoing).toEqual([]);
      } else {
        expect(await exportLogs()).toBe(1);
        expect(await exportLogs()).toBe(0);
        expect(outgoing).toHaveLength(1);
        expect(JSON.parse(outgoing[0] ?? "{}").events[0].action).toBe("created");
      }
      const [row] = await fixture.run((db) =>
        db.execute<{ exported_at: string | null }>({
          text: "SELECT exported_at FROM audit_log WHERE id=1",
          params: [],
        }),
      );
      expect(row?.exported_at !== null).toBe(tenancy === "none");
    } finally {
      globalThis.fetch = originalFetch;
      resetDnsLookupForTests();
      await app.stop();
      await fixture.application.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("application view data renders established users, guest state and captured OIDC availability", async () => {
  const root = await mkdtemp(join(tmpdir(), "strata-user-view-"));
  await mkdir(join(root, "views"));
  await writeFile(
    join(root, "views/user.eta"),
    "<%~ JSON.stringify({user:it.currentUser,app:it.appName,oidc:it.oidcLogin}) %>",
  );
  const env: Record<string, string | undefined> = {
    DATABASE_URL: "sqlite://fixture",
    QUEUE_DRIVER: "sync",
    CACHE_DRIVER: "array",
    FRONTEND_MODE: "server-htmx",
    APP_NAME: "Captured app",
    FEATURE_OAUTH: "true",
    OIDC_CLIENT_ID: "fixture-client",
    OIDC_CLIENT_SECRET: "fixture-client-secret",
    SESSION_SECRET: "fixture-session-secret-01234567890123456789",
  };
  const handle = createApplicationContext([], {
    connection: "main",
    definition: { providers: [], services: createApplicationServices(env, unusedInvoke, root) },
    providersFromScope(scope) {
      const providers = createApplicationProviders(
        definition(root),
        env,
        auth,
        scope.resolve(APPLICATION_CACHE),
        scope.resolve(APPLICATION_QUEUE),
        scope.resolve(APPLICATION_QUEUE_SERVICES),
        scope.resolve(APPLICATION_EVENT_BUS_TOKEN),
        scope.resolve(APPLICATION_BILLING),
        scope.resolve(APPLICATION_STORAGE),
        scope.resolve(QUEUE_JOB_REGISTRY_TOKEN),
      );
      env.OIDC_CLIENT_SECRET = "";
      env.APP_NAME = "changed";
      return providers;
    },
  });
  try {
    const context = await handle.start();
    const engine = context.container.resolve(CORE_VIEW_TOKEN);
    const request = new Request("https://fixture.example/profile");
    for (const user of [
      null,
      { id: "7" },
      { id: 9, name: "Ada", email: "ada@example.test", role: "admin" },
    ]) {
      const rendered = await runWithEstablishedAuth(
        request,
        { user, credentialSource: user ? "session" : "guest" },
        () => engine.render("user", {}, { request, layout: false }),
      );
      const data = JSON.parse(rendered);
      expect(data.app).toBe("Captured app");
      expect(data.oidc).toBe(true);
      expect(data.user).toEqual(
        user
          ? {
              id: Number(user.id),
              name: "name" in user ? user.name : "",
              email: "email" in user ? user.email : "",
              role: "role" in user ? user.role : "member",
            }
          : null,
      );
    }
  } finally {
    await handle.application.stop();
    await rm(root, { recursive: true, force: true });
  }
});
