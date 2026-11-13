import { test } from "bun:test";
import assert from "node:assert/strict";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import type { Application, ResourceSpec } from "@getstrata/core/contracts/application";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { RawPool } from "@getstrata/core/database/driverPorts";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import type { Server } from "bun";
import { createHttpKernel } from "../../src/bootstrap/httpKernel";
import { HTTP_PERSISTENCE_OPTIONS } from "../../src/bootstrap/httpPersistence";
import type { HttpPersistenceOptions } from "../../src/bootstrap/persistenceContracts";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { webServerResource } from "../../src/bootstrap/web/server";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";

test("BP7 actual native HTTP drain owns the metadata-business gap before pool close", async () => {
  const metadataSettled = deferred();
  const releaseGap = deferred();
  let poolCloses = 0;
  let handlers = 0;
  let server: Server<unknown> | undefined;
  let app: Application;
  const invoke: PersistenceInvocation = (envelope, work) => {
    const actual = createPersistenceInvocation(app, "main")(envelope, work);
    return envelope.metadata?.phase === "metadata"
      ? actual.then(async (result) => {
          metadataSettled.resolve();
          await releaseGap.promise;
          return result;
        })
      : actual;
  };
  const container = new ServiceContainer();
  const options: HttpPersistenceOptions = {
    tenancy: "none",
    production: true,
    allowTenantDevHeaders: false,
    metadata: (ports) => ({
      authenticate: async () => {
        const rows = await ports.database.execute({ text: "SELECT id FROM gap_rows", params: [] });
        assert.equal(rows.length, 1);
        return { user: { id: 1, role: "admin" }, credentialSource: "session" };
      },
      memberships: async () => [],
      userTenantId: async () => 1,
      tenant: async () => null,
    }),
  };
  container.set(HTTP_PERSISTENCE_OPTIONS, options);
  const kernel = createHttpKernel({
    invoke,
    container,
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
    storage: new StorageManager(createStorageDriver()),
  });
  const bindings = createDatabaseBindings({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const pool = bindings.find((declaration) => declaration.kind === "resource");
  assert.ok(pool);
  const originalCreate = pool.create as (...dependencies: unknown[]) => ResourceSpec<RawPool>;
  app = createApplication({
    services: bindings,
    providers: [
      {
        name: "owned.gap.transport",
        setup: async (scope) => {
          server = await scope.acquire(
            webServerResource({
              port: 0,
              native: { hostname: "127.0.0.1" },
              routes: {
                "/gap": kernel.wrapApi(async () => {
                  handlers++;
                  return Response.json({ unexpected: "business admitted after stop" });
                }),
              },
            }),
          );
        },
      },
    ],
    overrides: [
      resourceService(pool.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: pool.dependencies,
        create: (...dependencies): ResourceSpec<RawPool> => {
          const specification = originalCreate(...dependencies);
          return {
            ...specification,
            close: (owned, context) => {
              poolCloses++;
              return specification.close?.(owned, context);
            },
          };
        },
      }),
    ],
  });
  await app.start();
  let request: Promise<Response> | undefined;
  let stopping: ReturnType<typeof app.stop> | undefined;
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({ text: "CREATE TABLE gap_rows (id INTEGER)", params: [] });
      await db.execute({ text: "INSERT INTO gap_rows VALUES (7)", params: [] });
    });
    assert.ok(server);
    request = fetch(`http://127.0.0.1:${server.port}/gap`, {
      headers: { accept: "application/json" },
    });
    await bounded(metadataSettled.promise, "actual HTTP metadata run settles before gap");
    stopping = app.stop();
    await pending(stopping);
    assert.equal(
      poolCloses,
      0,
      "No active run remains in the gap, so transport tracking must hold the pool",
    );
    releaseGap.resolve();
    const response = await bounded(request, "tracked shutdown error response");
    await response.text();
    assert.ok(
      response.status >= 500,
      "Admitted pipeline formats failed business admission during shutdown",
    );
    assert.equal(handlers, 0);
    assert.equal(
      (await bounded(stopping, "native response drain and pool close")).successful,
      true,
    );
    assert.equal(poolCloses, 1);
  } finally {
    releaseGap.resolve();
    await server?.stop(true);
    await Promise.allSettled([request]);
    await app.stop();
    kernel.dispose();
  }
});

import { restoreEnvVar } from "../helpers/restoreEnv";

test("BP7 native public documents and synthesized preflights skip auth metadata while transport drain retains pools", async () => {
  const previousOrigins = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = "https://public.test";
  const entered = deferred();
  const release = deferred();
  let metadataCalls = 0;
  let poolCloses = 0;
  let server: Server<unknown> | undefined;
  let app: Application;
  const invoke: PersistenceInvocation = (envelope, work) =>
    createPersistenceInvocation(app, "main")(envelope, work);
  const container = new ServiceContainer();
  container.set(HTTP_PERSISTENCE_OPTIONS, {
    tenancy: "none",
    production: false,
    allowTenantDevHeaders: false,
    metadata: () => ({
      authenticate: async () => {
        metadataCalls++;
        return { user: null, credentialSource: null };
      },
      memberships: async () => [],
      userTenantId: async () => 1,
      tenant: async () => null,
    }),
  } satisfies HttpPersistenceOptions);
  const kernel = createHttpKernel({
    invoke,
    container,
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
    storage: new StorageManager(createStorageDriver()),
  });
  const bindings = createDatabaseBindings({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const pool = bindings.find((declaration) => declaration.kind === "resource");
  assert.ok(pool);
  const originalCreate = pool.create as (...dependencies: unknown[]) => ResourceSpec<RawPool>;
  app = createApplication({
    services: bindings,
    providers: [
      {
        name: "owned.public.transport",
        setup: async (scope) => {
          server = await scope.acquire(
            webServerResource({
              port: 0,
              native: { hostname: "127.0.0.1" },
              enter: (request, work) => kernel.run(request, work),
              routes: {
                "/public": kernel.wrapPublicDocument(async () => {
                  entered.resolve();
                  await release.promise;
                  return new Response("public document");
                }),
              },
            }),
          );
        },
      },
    ],
    overrides: [
      resourceService(pool.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: pool.dependencies,
        create: (...dependencies): ResourceSpec<RawPool> => {
          const specification = originalCreate(...dependencies);
          return {
            ...specification,
            close: (owned, context) => {
              poolCloses++;
              return specification.close?.(owned, context);
            },
          };
        },
      }),
    ],
  });
  let request: Promise<Response> | undefined;
  try {
    await app.start();
    assert.ok(server);
    const url = `http://127.0.0.1:${server.port}/public`;
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { origin: "https://public.test", "access-control-request-method": "GET" },
    });
    await preflight.text();
    assert.equal(preflight.status, 204);
    assert.equal(metadataCalls, 0, "Synthesized preflight must not enter identity metadata");
    request = fetch(url, { headers: { authorization: "Basic cHVibGljOnByb29m" } });
    await bounded(entered.promise);
    assert.equal(
      metadataCalls,
      0,
      "A public document must not consume user credentials or load auth metadata",
    );
    const stop = app.stop();
    await pending(stop);
    assert.equal(
      poolCloses,
      0,
      "Pure public work still belongs to the active native transport barrier",
    );
    release.resolve();
    const response = await bounded(request);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "public document");
    assert.equal((await bounded(stop)).successful, true);
    assert.equal(poolCloses, 1);
  } finally {
    release.resolve();
    await server?.stop(true);
    await Promise.allSettled([request]);
    await app.stop();
    kernel.dispose();
    restoreEnvVar("CORS_ALLOWED_ORIGINS", previousOrigins);
  }
});
