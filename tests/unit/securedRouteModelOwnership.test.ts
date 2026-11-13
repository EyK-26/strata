import { test } from "bun:test";
import assert from "node:assert/strict";
import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { HttpPersistenceOptions } from "@getstrata/bootstrap/persistenceContracts";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { establishedAuthReader, runWithEstablishedAuth } from "@getstrata/core/auth/authReader";
import type { Policy } from "@getstrata/core/auth/policy";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import { BadRequestError, ForbiddenError } from "@getstrata/core/errors/http";
import { etagFromResource } from "@getstrata/core/http/etag";
import type { RouteRequest } from "@getstrata/core/http/route";
import {
  type RouteModelAuthorization,
  type RouteModelBindingPorts,
  securedBindRouteModel,
  securedBindRouteModelByKey,
} from "@getstrata/core/http/securedRouteModelBinding";
import { createApplication } from "@getstrata/core/runtime/application";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { HTTP_PERSISTENCE_OPTIONS } from "../../src/bootstrap/httpPersistence";

type Params = { id: string };
type Row = { id: number; tenant_id: number; name: string; updated_at: string };
const row: Row = { id: 1, tenant_id: 1, name: "owned", updated_at: "2026-01-01" };
function request(
  method = "GET",
  headers: RequestInit["headers"] = {},
  id = "1",
): RouteRequest<Params> {
  return Object.assign(new Request("https://owned.example.test/widgets/1", { method, headers }), {
    params: { id },
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function bind(
  kind: "numeric" | "key",
  resolver: (id: number | string, request: RouteRequest<Params>) => Promise<Row>,
  authorization: RouteModelAuthorization,
  handler: (request: RouteRequest<Params>, model: Row) => Promise<Response>,
  ports: RouteModelBindingPorts,
) {
  return kind === "numeric"
    ? securedBindRouteModel("id", resolver, authorization, handler, ports)
    : securedBindRouteModelByKey("id", resolver, authorization, handler, ports);
}

for (const kind of ["numeric", "key"] as const) {
  test(`${kind} binding snapshots callbacks and awaits deferred opaque denial before conditions`, async () => {
    for (const opaque of [false, new Error("owned authorization denial")]) {
      const entered = deferred(),
        decision = deferred();
      const events: string[] = [];
      const auth = {
        calls: 0,
        async resolve(_request?: Request): Promise<AuthUser | null> {
          this.calls++;
          events.push("auth");
          return { id: 7 };
        },
      };
      const ports = {
        auth,
        etagEnabled: true,
        async authorize(
          _resource: string,
          _action: keyof Policy,
          user: AuthUser | null,
          model: unknown,
        ) {
          assert.strictEqual(this, ports);
          assert.equal(user?.id, 7);
          assert.strictEqual(model, row);
          events.push("authorize");
          entered.resolve();
          await decision.promise;
          throw opaque;
        },
      };
      const authorization: RouteModelAuthorization = { resource: "widget", action: "update" };
      const handler = bind(
        kind,
        async () => {
          events.push("resolve");
          return row;
        },
        authorization,
        async () => {
          events.push("handler");
          return Response.json(row);
        },
        ports,
      );
      auth.resolve = async () => {
        throw new Error("replacement auth must not run");
      };
      ports.authorize = async () => {
        throw new Error("replacement gate must not run");
      };
      ports.etagEnabled = false;
      authorization.action = "view";
      let settled = false;
      const observed = handler(request("PATCH")).then(
        (value) => {
          settled = true;
          return { ok: true as const, value };
        },
        (error) => {
          settled = true;
          return { ok: false as const, error };
        },
      );
      await entered.promise;
      assert.equal(settled, false);
      assert.deepEqual(events, ["resolve", "auth", "authorize"]);
      decision.resolve();
      const result = await observed;
      assert.equal(result.ok, false);
      if (!result.ok) assert.strictEqual(result.error, opaque);
      assert.equal(auth.calls, 1);
      assert.ok(!events.includes("handler"));
    }
  });

  test(`${kind} binding awaits allow then enforces captured ETag and uses exact established request`, async () => {
    const entered = deferred(),
      decision = deferred();
    let handlers = 0;
    const ports = {
      auth: { resolve: async () => ({ id: 1 }) },
      etagEnabled: true,
      authorize: async () => {
        entered.resolve();
        await decision.promise;
      },
    };
    const handler = bind(
      kind,
      async () => row,
      { resource: "widget", action: "update" },
      async () => {
        handlers++;
        return Response.json(row);
      },
      ports,
    );
    const pending = handler(request("PATCH"));
    const rejection = pending.then(
      () => null,
      (error) => error,
    );
    await entered.promise;
    assert.equal(handlers, 0);
    ports.etagEnabled = false;
    decision.resolve();
    const error = await rejection;
    assert.equal(error?.status, 412);
    assert.equal(handlers, 0);
    const expected = request("PATCH", { "if-match": "*" });
    const scoped = bind(
      kind,
      async () => row,
      { resource: "widget", action: "update" },
      async () => Response.json(row),
      { auth: establishedAuthReader, authorize: async () => {}, etagEnabled: true },
    );
    await assert.rejects(
      () =>
        runWithEstablishedAuth(expected, { user: { id: 1 }, credentialSource: "bearer" }, () =>
          scoped(request("PATCH", { "if-match": "*" })),
        ),
      /Authentication request scope mismatch/,
    );
    assert.equal(
      (
        await runWithEstablishedAuth(
          expected,
          { user: { id: 1 }, credentialSource: "bearer" },
          () => scoped(expected),
        )
      ).status,
      200,
    );
  });

  test(`${kind} binding retains parse, null model, auth rejection and view ETag options`, async () => {
    let calls = 0;
    const ports: RouteModelBindingPorts = {
      auth: {
        resolve: async () => {
          calls++;
          return null;
        },
      },
      authorize: async () => {},
      etagEnabled: true,
    };
    const invalid = bind(
      kind,
      async () => {
        calls++;
        return row;
      },
      { resource: "widget", action: "view" },
      async () => Response.json(row),
      ports,
    );
    await assert.rejects(
      () => invalid(request("GET", {}, kind === "numeric" ? "invalid" : " ")),
      BadRequestError,
    );
    assert.equal(calls, 0);
    const missing =
      kind === "numeric"
        ? securedBindRouteModel(
            "id",
            async () => null,
            { resource: "widget", action: "view" },
            async () => {
              calls++;
              return new Response();
            },
            ports,
          )
        : securedBindRouteModelByKey(
            "id",
            async () => null,
            { resource: "widget", action: "view" },
            async () => {
              calls++;
              return new Response();
            },
            ports,
          );
    await assert.rejects(
      () => missing(request()),
      (error) => error instanceof Error && "status" in error && error.status === 404,
    );
    assert.equal(calls, 0);
    const authFailure = new Error("owned auth rejection");
    await assert.rejects(
      () =>
        bind(
          kind,
          async () => row,
          { resource: "widget", action: "view" },
          async () => {
            calls++;
            return new Response();
          },
          {
            ...ports,
            auth: {
              resolve: async () => {
                throw authFailure;
              },
            },
          },
        )(request()),
      (error) => error === authFailure,
    );
    assert.equal(calls, 0);
    for (const etag of [undefined, true, false]) {
      const html = bind(
        kind,
        async () => row,
        { resource: "widget", action: "view", etag },
        async () =>
          new Response("<html>owned</html>", { headers: { "content-type": "text/html" } }),
        ports,
      );
      const result = await html(request("GET", { "if-none-match": etagFromResource(row) }));
      assert.equal(result.status, etag === true ? 304 : 200);
    }
  });
}

const widgets = defineRepository({
  name: "OwnershipWidgets",
  table: defineTable<Row, "id">({
    name: "widgets",
    primaryKey: "id",
    columns: ["id", "tenant_id", "name", "updated_at"],
  }),
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});

test("two actual composed applications retain their own gate, selected tenant and captured ETag flags", async () => {
  const cleanups: Array<() => Promise<void>> = [],
    failures: unknown[] = [];
  const previous = process.env.FEATURE_ETAG;
  async function compose(
    name: string,
    tenantId: number,
    etagEnabled: boolean,
    allowUpdate: boolean,
  ) {
    const app = createApplication({
      providers: [],
      services: createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [widgets],
      }),
    });
    const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60000, 20)));
    let kernel: ReturnType<typeof createHttpKernel> | undefined;
    cleanups.push(async () => {
      const errors: unknown[] = [];
      try {
        kernel?.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        await cache.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        const stopped = await app.stop();
        assert.equal(stopped.successful, true);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, "Owned test application cleanup failed.");
    });
    await app.start();
    const invoke = createPersistenceInvocation(app, "main");
    await invoke({ kind: "command" }, async ({ database }) => {
      await database.execute({
        text: "CREATE TABLE widgets(id INTEGER PRIMARY KEY,tenant_id INTEGER,name TEXT,updated_at TEXT)",
        params: [],
      });
      await database.repository(widgets).create({ ...row, tenant_id: tenantId, name });
    });
    let controlled: ReturnType<typeof deferred> | undefined,
      entered: ReturnType<typeof deferred> | undefined;
    let handlers = 0;
    const container = new ServiceContainer();
    container.set(CORE_POLICY_GATE_TOKEN, {
      async authorize(resource: string, action: string, user: AuthUser | null, model: Row) {
        assert.equal(resource, "widget");
        assert.equal(user?.id, tenantId + 40);
        assert.equal(model.tenant_id, tenantId);
        if (action === "update") {
          entered?.resolve();
          await controlled?.promise;
          if (!allowUpdate) throw new ForbiddenError(`${name} denied`);
        }
      },
    });
    const features = {
      emailVerificationRequired: false,
      viewsEnabled: false,
      publicReadsEnabled: false,
      etagEnabled,
    };
    const http: HttpPersistenceOptions = {
      features,
      tenancy: "column",
      production: false,
      allowTenantDevHeaders: false,
      metadata: () => ({
        authenticate: async () => ({
          user: { id: tenantId + 40, role: "member" },
          credentialSource: "bearer",
        }),
        memberships: async () => [],
        userTenantId: async () => tenantId,
        tenant: async (id) => ({ id, slug: name }),
      }),
    };
    container.set(HTTP_PERSISTENCE_OPTIONS, http);
    const selectedKernel = createHttpKernel({
      container,
      invoke,
      cache,
      storage: new StorageManager(createStorageDriver()),
    });
    kernel = selectedKernel;
    const route = (action: "view" | "update") =>
      selectedKernel.wrapApi<RouteRequest<Params>>(async (req, ports) => {
        const repository = ports.database.repository(widgets);
        return securedBindRouteModel(
          "id",
          async (id) => {
            const record = (
              await repository.findAll({ where: { id, tenant_id: ports.established.tenant.id } })
            )[0];
            assert.ok(record);
            return record;
          },
          { resource: "widget", action },
          async (_request, record) => {
            handlers++;
            if (action === "update")
              await repository.updateById(record.id, { name: `${name} updated` });
            return Response.json(record);
          },
          selectedKernel.routeModelBindingPorts(ports.auth),
        )(req);
      });
    return {
      route,
      features,
      handlers: () => handlers,
      control() {
        entered = deferred();
        controlled = deferred();
        return { entered, decision: controlled };
      },
      stored: () =>
        invoke({ kind: "command" }, ({ database }) => database.repository(widgets).findById(1)),
    };
  }
  try {
    const a = await compose("app-a", 1, true, true),
      b = await compose("app-b", 2, false, false);
    a.features.etagEnabled = false;
    b.features.etagEnabled = true;
    process.env.FEATURE_ETAG = "false";
    const tag = etagFromResource(row);
    assert.equal((await a.route("view")(request("GET", { "if-none-match": tag }))).status, 304);
    process.env.FEATURE_ETAG = "true";
    const bRead = await b.route("view")(request("GET", { "if-none-match": tag }));
    assert.equal(bRead.status, 200);
    assert.equal(bRead.headers.get("etag"), null);
    const otherBody: unknown = await bRead.json();
    assert.ok(otherBody !== null && typeof otherBody === "object" && "tenant_id" in otherBody);
    assert.equal(otherBody.tenant_id, 2);
    const aBefore = a.handlers(),
      bBefore = b.handlers(),
      aControl = a.control(),
      bControl = b.control();
    let aSettled = false,
      bSettled = false;
    const aPending = Promise.resolve(a.route("update")(request("PATCH"))).then((value) => {
      aSettled = true;
      return value;
    });
    const bPending = Promise.resolve(b.route("update")(request("PATCH"))).then((value) => {
      bSettled = true;
      return value;
    });
    const admissions = await Promise.all([
      Promise.race([aControl.entered.promise.then(() => true), aPending.then(() => false)]),
      Promise.race([bControl.entered.promise.then(() => true), bPending.then(() => false)]),
    ]);
    assert.deepEqual(
      admissions,
      [true, true],
      "Both requests must reach their own gate before responding.",
    );
    assert.equal(aSettled, false);
    assert.equal(bSettled, false);
    assert.equal(a.handlers(), aBefore);
    assert.equal(b.handlers(), bBefore);
    bControl.decision.resolve();
    assert.equal((await bPending).status, 403);
    aControl.decision.resolve();
    assert.equal((await aPending).status, 412);
    assert.equal(a.handlers(), aBefore);
    assert.equal(b.handlers(), bBefore);
    assert.equal((await a.stored())?.name, "app-a");
    assert.equal((await b.stored())?.name, "app-b");
    assert.equal((await a.route("update")(request("PATCH", { "if-match": "*" }))).status, 200);
    assert.equal((await a.stored())?.name, "app-a updated");
    assert.equal((await b.stored())?.name, "app-b");
  } catch (error) {
    failures.push(error);
  } finally {
    if (previous === undefined) delete process.env.FEATURE_ETAG;
    else process.env.FEATURE_ETAG = previous;
    for (const close of cleanups.reverse())
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Two application ownership test and cleanup failed.");
});
