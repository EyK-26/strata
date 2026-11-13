import { beforeAll, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import {
  currentAuthUser,
  currentCredentialSource,
  runWithAuthContext,
} from "@getstrata/core/auth/authContext";
import { AuthManager } from "@getstrata/core/auth/guard";
import type { ScopedPolicy } from "@getstrata/core/contracts/persistence";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import type { DatabaseDefinition } from "@getstrata/core/database/driverPorts";
import { Model } from "@getstrata/core/database/model";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import {
  createCsrfMiddleware,
  csrfMiddlewareOptionsFromEnvironment,
} from "@getstrata/core/http/csrfMiddleware";
import {
  createCsrfTokenCookie,
  csrfTokenOptionsFromEnvironment,
} from "@getstrata/core/http/csrfToken";
import { currentRequestMeta, runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import {
  currentTenantId,
  runWithTenant,
  type TenantContext,
} from "@getstrata/core/tenant/tenantContext";
import { createTenantMiddleware } from "@getstrata/core/tenant/tenantMiddleware";
import { authFixtureOutcome } from "../helpers/authOutcome";
import { type DatabaseInvocation, withBoundDatabase } from "../helpers/boundRepositoryHarness";
import { sessionSql } from "../helpers/nativePersistenceApplication";
import { createMockDependencies, defaultTestTenant } from "../unit/testHelpers";

const rlsUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
async function withRls(
  work: (invoke: DatabaseInvocation) => Promise<void>,
  registry: Pick<DatabaseDefinition, "repositories" | "models"> = {},
  max = 5,
) {
  if (!rlsUrl) throw Error("A restricted Postgres test URL is required.");
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "pgsql", url: rlsUrl, max } },
        ...registry,
      },
    },
    (_root, invoke) => work(invoke),
  );
}
function tenantRun<T>(
  invoke: DatabaseInvocation,
  tenant: TenantContext,
  work: (selected: TransactionSession, policy: ScopedPolicy) => T | Promise<T>,
): Promise<T> {
  return invoke(
    (database, policy) =>
      runWithTenant(tenant, () =>
        policy.run(database, { kind: "tenant", tenantId: tenant.id }, (selected) =>
          work(selected, policy),
        ),
      ),
    {
      kind: "command",
      tenant: { id: tenant.id },
      actor: { kind: "system", policy: "integration.tenant" },
    },
  );
}
async function settings(selected: DatabaseSession | TransactionSession) {
  const [row] = await selected.execute<{
    tenant: string | null;
    bypass: string | null;
    identifier: string | null;
  }>({
    text: `SELECT NULLIF(current_setting('app.tenant_id', true), '') AS tenant,NULLIF(current_setting('app.bypass_rls', true), '') AS bypass,NULLIF(current_setting('app.bypass_identifier', true), '') AS identifier`,
    params: [],
  });
  if (!row) throw Error("Postgres returned no transaction settings.");
  return row;
}
describe.skipIf(!rlsUrl)("real Postgres transaction/RLS composition", () => {
  beforeAll(async () => {
    await withRls(async (invoke) => {
      await invoke(async (database) => {
        const [role] = await database.execute<{ rolsuper: boolean; rolbypassrls: boolean }>({
          text: "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          params: [],
        });
        expect(role?.rolsuper).toBe(false);
        expect(role?.rolbypassrls).toBe(false);
      });
    });
  });
  test.each(["transaction", "reserved", "tenant", "bypass", "identifier"])(
    "cold and queued %s callbacks retain complete caller context",
    async (mode) =>
      withRls(
        async (invoke) => {
          const appContext = new AsyncLocalStorage<string>();
          const values = await Promise.all(
            Array.from({ length: 6 }, (_, index) => {
              const id = index + 1,
                tenant = { ...defaultTestTenant, id };
              return runWithTenant(tenant, () =>
                runWithAuthContext({ id, role: "member" }, "bearer", () =>
                  runWithRequestMeta(
                    { ipAddress: "127.0.0.1", userAgent: `caller-${id}`, cspNonce: `nonce-${id}` },
                    () =>
                      appContext.run(`app-${id}`, () =>
                        invoke(
                          async (database, policy) => {
                            const check = () => {
                              expect(currentAuthUser()?.id).toBe(id);
                              expect(currentCredentialSource()).toBe("bearer");
                              expect(currentTenantId()).toBe(id);
                              expect(currentRequestMeta().userAgent).toBe(`caller-${id}`);
                              expect(currentRequestMeta().cspNonce).toBe(`nonce-${id}`);
                              expect(appContext.getStore()).toBe(`app-${id}`);
                            };
                            const work = async (child: TransactionSession) => {
                              check();
                              await child.execute({ text: "SELECT pg_sleep(0.005)", params: [] });
                              check();
                              await child.transaction(async () => {
                                check();
                              });
                              await expect(
                                child.transaction(async () => {
                                  check();
                                  throw new Error("Nested caller failure");
                                }),
                              ).rejects.toThrow("Nested caller failure");
                              check();
                              return id;
                            };
                            const result =
                              mode === "reserved"
                                ? await database.transaction(work, {
                                    acquisitionSignal: new AbortController().signal,
                                  })
                                : mode === "transaction"
                                  ? await database.transaction(work)
                                  : await policy.run(
                                      database,
                                      mode === "tenant"
                                        ? { kind: "tenant", tenantId: id }
                                        : mode === "bypass"
                                          ? { kind: "bypass" }
                                          : { kind: "identifier", identifier: id },
                                      work,
                                    );
                            check();
                            return result;
                          },
                          {
                            kind: "command",
                            tenant: { id },
                            actor: { kind: "system", policy: "integration.context" },
                          },
                        ),
                      ),
                  ),
                ),
              );
            }),
          );
          expect(values).toEqual([1, 2, 3, 4, 5, 6]);
          expect(currentAuthUser()).toBeNull();
          expect(currentCredentialSource()).toBeNull();
          expect(appContext.getStore()).toBeUndefined();
        },
        {},
        1,
      ),
  );
  test("real concurrent JSON/HTML requests preserve bearer admission and cookie CSRF", async () =>
    withRls(
      async (invoke) => {
        const marker = new AsyncLocalStorage<string>();
        const auth = new AuthManager({ authenticate: () => authFixtureOutcome(null) });
        auth.registerGuard("api", {
          authenticate(request) {
            return authFixtureOutcome(
              (async () => {
                const match = /^Bearer fixture-(\d+)$/.exec(
                  request.headers.get("authorization") ?? "",
                );
                return match ? { id: Number(match[1]), role: "member" } : null;
              })(),
              "bearer",
            );
          },
        });
        auth.registerGuard("web", {
          authenticate(request) {
            return authFixtureOutcome(
              (async () => {
                const match = /fixture_user=(\d+)/.exec(request.headers.get("cookie") ?? "");
                return match ? { id: Number(match[1]), role: "member" } : null;
              })(),
            );
          },
        });
        const kernel = createHttpKernel(
          createMockDependencies(
            new ServiceContainer(),
            undefined,
            undefined,
            (envelope, work) => invoke((database, policy) => work({ database, policy }), envelope),
            {
              tenancy: "rls",
              production: false,
              allowTenantDevHeaders: false,
              metadata: () => ({
                authenticate: (request) => auth.authenticate(request),
                memberships: async () => [],
                userTenantId: async (id) => id,
                tenant: async (id) => ({ ...defaultTestTenant, id }),
              }),
            },
          ),
        );
        const csrf = createCsrfMiddleware(csrfMiddlewareOptionsFromEnvironment(process.env));
        const business = async (
          request: Request,
          ports: import("@getstrata/bootstrap/persistenceContracts").BusinessRequestPorts,
        ) => {
          if (!ports.established.auth.user)
            return Response.json({ error: "Unauthenticated" }, { status: 401 });
          return csrf(request, async () => {
            await ports.database.execute({ text: "SELECT pg_sleep(0.005)", params: [] });
            const result = {
              id: currentAuthUser()?.id,
              source: currentCredentialSource(),
              tenant: currentTenantId(),
              marker: marker.getStore(),
            };
            return new URL(request.url).pathname === "/html"
              ? new Response(
                  `<p>${result.id}:${result.source}:${result.tenant}:${result.marker}</p>`,
                  { headers: { "content-type": "text/html" } },
                )
              : Response.json(result);
          });
        };
        const json = kernel.wrap("api", business),
          html = kernel.wrapWeb(business);
        const server = Bun.serve({
          port: 0,
          fetch: (request) =>
            marker.run(request.headers.get("x-fixture-marker") ?? "", () =>
              runWithRequestMeta({ ipAddress: "127.0.0.1", userAgent: "fixture" }, () =>
                new URL(request.url).pathname === "/html" ? html(request) : json(request),
              ),
            ),
        });
        const origin = `http://localhost:${server.port}`;
        try {
          const responses = await Promise.all(
            Array.from({ length: 6 }, async (_, index) => {
              const id = index + 1,
                path = index % 2 ? "/html" : "/json";
              const response = await fetch(origin + path, {
                method: "POST",
                headers: {
                  authorization: `Bearer fixture-${id}`,
                  "x-fixture-marker": `request-${id}`,
                },
              });
              expect(response.status).toBe(200);
              if (path === "/json")
                expect(await response.json()).toEqual({
                  id,
                  source: "bearer",
                  tenant: id,
                  marker: `request-${id}`,
                });
              else expect(await response.text()).toBe(`<p>${id}:bearer:${id}:request-${id}</p>`);
              return response.status;
            }),
          );
          expect(responses).toEqual([200, 200, 200, 200, 200, 200]);
          const csrf = createCsrfTokenCookie(csrfTokenOptionsFromEnvironment(process.env));
          await Promise.all(
            Array.from({ length: 6 }, async (_, index) => {
              const id = index + 1;
              const headers = {
                origin,
                cookie: `fixture_user=${id}; ${csrf.cookie.split(";")[0]}`,
                "x-fixture-marker": `cookie-${id}`,
              };
              const rejected = await fetch(`${origin}/json`, { method: "POST", headers });
              expect(rejected.status).toBe(403);
              const accepted = await fetch(`${origin}/json`, {
                method: "POST",
                headers: { ...headers, "x-csrf-token": csrf.token },
              });
              expect(accepted.status).toBe(200);
              expect(await accepted.json()).toEqual({
                id,
                source: "session",
                tenant: id,
                marker: `cookie-${id}`,
              });
              const invalid = await fetch(`${origin}/json`, {
                method: "POST",
                headers: {
                  ...headers,
                  authorization: "Bearer invalid",
                  "x-csrf-token": csrf.token,
                },
              });
              expect(invalid.status).toBe(401);
            }),
          );
          expect(currentAuthUser()).toBeNull();
          expect(marker.getStore()).toBeUndefined();
        } finally {
          await server.stop(true);
          kernel.dispose();
        }
      },
      {},
      1,
    ));
  test("tenant switching is rejected without changing SQL or async context", async () =>
    withRls(async (invoke) => {
      await tenantRun(invoke, defaultTestTenant, async (selected, policy) => {
        expect(() =>
          policy.run(selected, { kind: "tenant", tenantId: 2 }, async () => undefined),
        ).toThrow("tenant identity mismatch");
        expect(currentTenantId()).toBe(1);
        expect((await settings(selected)).tenant).toBe("1");
      });
    }));
  test("same-tenant nested scopes restore bypass and identifier on success and failure", async () =>
    withRls(async (invoke) => {
      await invoke(
        (database, policy) =>
          runWithTenant(defaultTestTenant, () =>
            policy.run(database, { kind: "bypass" }, (bypass) =>
              policy.run(bypass, { kind: "identifier", identifier: "pinned" }, async (selected) => {
                const before = await settings(selected);
                await policy.run(selected, { kind: "tenant", tenantId: 1 }, async (tenant) => {
                  expect((await settings(tenant)).bypass).toBe("false");
                  await policy.run(tenant, { kind: "tenant", tenantId: 1 }, async () => {
                    expect(currentTenantId()).toBe(1);
                  });
                });
                expect(await settings(selected)).toEqual(before);
                await expect(
                  policy.run(selected, { kind: "tenant", tenantId: 1 }, async () => {
                    throw new Error("scope failed");
                  }),
                ).rejects.toThrow("scope failed");
                expect(await settings(selected)).toEqual(before);
              }),
            ),
          ),
        {
          kind: "command",
          tenant: { id: 1 },
          actor: { kind: "system", policy: "integration.explicit-bypass" },
        },
      );
    }));
  test("SQL failures roll back to savepoints and restricted-role RLS still applies", async () => {
    await withRls(async (invoke) => {
      await tenantRun(invoke, defaultTestTenant, async (selected, _policy) => {
        const db = sessionSql(selected);

        await db.unsafe(
          "CREATE TEMP TABLE composition_rls (tenant_id INTEGER, value INTEGER UNIQUE) ON COMMIT DROP",
        );
        await db.unsafe("ALTER TABLE composition_rls ENABLE ROW LEVEL SECURITY");
        await db.unsafe("ALTER TABLE composition_rls FORCE ROW LEVEL SECURITY");
        await db.unsafe(
          "CREATE POLICY composition_scope ON composition_rls USING (tenant_id = current_setting('app.tenant_id')::integer)",
        );
        await db.unsafe("INSERT INTO composition_rls VALUES (1, 1)");
        await expect(
          selected.transaction(async (child) => {
            const db = sessionSql(child);

            await db.unsafe("INSERT INTO composition_rls VALUES (1, 2)");
            await db.unsafe("INSERT INTO composition_rls VALUES (2, 3)");
          }),
        ).rejects.toThrow();
        expect(await db.unsafe("SELECT value FROM composition_rls")).toEqual([{ value: 1 }]);
        await db.unsafe("INSERT INTO composition_rls VALUES (1, 4)");
      });
    });
  });

  test("trusted host requests preserve concurrent restricted-role RLS settings", async () => {
    await withRls(async (invoke) => {
      const middleware = createTenantMiddleware({
        auth: { user: null, credentialSource: null },
        config: { enabled: true, production: true, allowDevHeaders: false },
        userTenantId: async (id) => id,
        publicTenancy: {
          resolveTenantId: async (host) =>
            host === "first.example" ? 1 : host === "second.example" ? 2 : null,
        },
        resolveTenant: async (id) => ({ id, slug: `host-${id}` }),
      });
      await Promise.all(
        [1, 2, 1, 2].map(async (id) => {
          const response = await middleware(
            new Request(`https://${id === 1 ? "first" : "second"}.example/catalog`, {
              headers: { "x-tenant-id": "999" },
            }),
            async () =>
              tenantRun(invoke, { ...defaultTestTenant, id }, async (selected) => {
                const db = sessionSql(selected);
                await db.unsafe("SELECT pg_sleep(0.02)");
                expect(currentTenantId()).toBe(id);
                expect((await settings(selected)).tenant).toBe(String(id));
                await db.unsafe("CREATE TEMP TABLE host_rls (tenant_id INTEGER) ON COMMIT DROP");
                await db.unsafe("ALTER TABLE host_rls ENABLE ROW LEVEL SECURITY");
                await db.unsafe("ALTER TABLE host_rls FORCE ROW LEVEL SECURITY");
                await db.unsafe(
                  "CREATE POLICY host_scope ON host_rls USING (tenant_id = current_setting('app.tenant_id')::integer)",
                );
                await db.unsafe("INSERT INTO host_rls VALUES ($1)", [id]);
                await expect(
                  selected.transaction((child) =>
                    sessionSql(child).unsafe("INSERT INTO host_rls VALUES ($1)", [id + 1]),
                  ),
                ).rejects.toThrow();
                expect(await db.unsafe("SELECT tenant_id FROM host_rls")).toEqual([
                  { tenant_id: id },
                ]);
                return new Response("ok");
              }),
          );
          expect(response.status).toBe(200);
        }),
      );
    });
  });
  test("concurrent root requests retain independent SQL tenant settings", async () => {
    await withRls(async (invoke) => {
      await Promise.all(
        [1, 2, 3].map((id) =>
          tenantRun(invoke, { ...defaultTestTenant, id }, async (selected, _policy) => {
            const db = sessionSql(selected);

            await db.unsafe("SELECT pg_sleep(0.02)");
            expect(currentTenantId()).toBe(id);
            expect((await settings(selected)).tenant).toBe(String(id));
          }),
        ),
      );
    });
  });
  test("declarative repositories preserve concurrent restricted-role RLS and savepoint rollback", async () => {
    const table = defineTable<{ id: number; tenant_id: number; value: number }, "id">({
      name: "composition_models",
      primaryKey: "id",
      columns: ["id", "tenant_id", "value"],
    });
    class CompositionModelEntity extends Model<
      { id: number; tenant_id: number; value: number },
      "id"
    > {}
    const CompositionModelRepository = defineRepository({
      name: "CompositionModelRepository",
      table: table,
      dependencies: [],
      create: (binding) => new BaseRepository(binding),
    });
    const CompositionModelDefinition = defineModel({
      name: "CompositionModel",
      repository: CompositionModelRepository,
      dependencies: [],
      attributes: { guarded: [], timestamps: false },
      construct: (state, binding) => new CompositionModelEntity(state, binding),
    });

    await withRls(
      async (invoke) => {
        await Promise.all(
          [1, 2, 3].map((id) =>
            tenantRun(invoke, { ...defaultTestTenant, id }, async (selected, _policy) => {
              const db = sessionSql(selected);
              const CompositionModel = selected.model(CompositionModelDefinition);

              await db.unsafe(
                "CREATE TEMP TABLE composition_models (id INTEGER PRIMARY KEY, tenant_id INTEGER, value INTEGER) ON COMMIT DROP",
              );
              await db.unsafe("ALTER TABLE composition_models ENABLE ROW LEVEL SECURITY");
              await db.unsafe("ALTER TABLE composition_models FORCE ROW LEVEL SECURITY");
              await db.unsafe(
                "CREATE POLICY composition_model_scope ON composition_models USING (tenant_id = current_setting('app.tenant_id')::integer)",
              );
              await CompositionModel.create({ id: 1, tenant_id: id, value: id });
              await expect(
                selected.transaction(async (child) => {
                  const CompositionModel = child.model(CompositionModelDefinition);

                  await CompositionModel.create({ id: 2, tenant_id: id, value: 2 });
                  await CompositionModel.create({ id: 3, tenant_id: id + 1, value: 3 });
                }),
              ).rejects.toThrow();
              expect(await CompositionModel.find(2)).toBeNull();
              expect((await CompositionModel.findOrFail(1)).get("tenant_id")).toBe(id);
              const projection = CompositionModel.query().select("value");
              expect(await projection.first()).toEqual({ value: id });
              expect(await projection.get()).toEqual([{ value: id }]);
              expect((await settings(selected)).tenant).toBe(String(id));
            }),
          ),
        );
      },
      { repositories: [CompositionModelRepository], models: [CompositionModelDefinition] },
    );
  });
  test("scoped cursor and chunk reads preserve concurrent restricted-role tenancy", async () => {
    type Row = { id: number; tenant_id: number; active: number };
    const table = defineTable<Row, "id">({
      name: "composition_scopes",
      primaryKey: "id",
      columns: ["id", "tenant_id", "active"],
    });
    class ScopedEntity extends Model<Row, "id"> {}
    const ScopedRepository = defineRepository({
      name: "ScopedRepository",
      table: table,
      dependencies: [],
      create: (binding) => new BaseRepository(binding),
    });
    const ScopedDefinition = defineModel({
      name: "Scoped",
      repository: ScopedRepository,
      dependencies: [],
      attributes: { guarded: [], timestamps: false },
      scopes: [(query) => query.where({ active: 1 })],
      construct: (state, binding) => new ScopedEntity(state, binding),
    });

    await withRls(
      async (invoke) => {
        await Promise.all(
          [1, 2, 3].map((id) =>
            tenantRun(invoke, { ...defaultTestTenant, id }, async (selected, _policy) => {
              const db = sessionSql(selected);
              const Scoped = selected.model(ScopedDefinition);

              await db.unsafe(
                "CREATE TEMP TABLE composition_scopes (id INTEGER PRIMARY KEY, tenant_id INTEGER, active INTEGER) ON COMMIT DROP",
              );
              await db.unsafe("ALTER TABLE composition_scopes ENABLE ROW LEVEL SECURITY");
              await db.unsafe("ALTER TABLE composition_scopes FORCE ROW LEVEL SECURITY");
              await db.unsafe(
                "CREATE POLICY scoped_tenant ON composition_scopes USING (tenant_id = current_setting('app.tenant_id')::integer)",
              );
              await Scoped.create({ id: 1, tenant_id: id, active: 1 });
              await Scoped.create({ id: 2, tenant_id: id, active: 0 });
              expect(await Scoped.query().where({ active: 0 }).get()).toEqual([]);
              expect(
                (await Scoped.query().where({ id: 1 }).orWhere({ id: 2 }).get()).map(
                  (row) => row.id,
                ),
              ).toEqual([1]);
              expect(
                (await Scoped.cursorPaginate({ perPage: 10 })).data.map((row) => row.id),
              ).toEqual([1]);
              const values: number[] = [];
              await Scoped.chunk(1, async (rows) => {
                values.push(...rows.map((row) => row.get("tenant_id")));
              });
              expect(values).toEqual([id]);
              expect(await Scoped.repository().count()).toBe(2);
              expect((await settings(selected)).tenant).toBe(String(id));
            }),
          ),
        );
      },
      { repositories: [ScopedRepository], models: [ScopedDefinition] },
    );
  });
  test("related model scopes preserve concurrent restricted-role connections", async () => {
    type ChildRow = { id: number; tenant_id: number; active: number };
    type ParentRow = { id: number; tenant_id: number; child_id: number };
    const childTable = defineTable<ChildRow, "id">({
      name: "relation_scope_children",
      primaryKey: "id",
      columns: ["id", "tenant_id", "active"],
    });
    const parentTable = defineTable<ParentRow, "id">({
      name: "relation_scope_parents",
      primaryKey: "id",
      columns: ["id", "tenant_id", "child_id"],
    });
    class ChildEntity extends Model<ChildRow, "id"> {}
    const ChildRepository = defineRepository({
      name: "ChildRepository",
      table: childTable,
      dependencies: [],
      create: (binding) => new BaseRepository(binding),
    });
    const ChildDefinition = defineModel({
      name: "Child",
      repository: ChildRepository,
      dependencies: [],
      attributes: { guarded: [], timestamps: false },
      scopes: [(query) => query.where({ active: 1 })],
      construct: (state, binding) => new ChildEntity(state, binding),
    });
    class ParentEntity extends Model<ParentRow, "id"> {
      children() {
        return this.hasMany(ChildDefinition, "tenant_id");
      }
      child() {
        return this.belongsTo(ChildDefinition, "child_id");
      }
    }
    const ParentRepository = defineRepository({
      name: "ParentRepository",
      table: parentTable,
      dependencies: [],
      create: (binding) => new BaseRepository(binding),
    });
    const ParentDefinition = defineModel({
      name: "Parent",
      repository: ParentRepository,
      dependencies: [],
      attributes: { guarded: [], timestamps: false },
      construct: (state, binding) => new ParentEntity(state, binding),
    });

    await withRls(
      async (invoke) => {
        await Promise.all(
          [1, 2, 3].map((id) =>
            tenantRun(invoke, { ...defaultTestTenant, id }, async (selected, _policy) => {
              const db = sessionSql(selected);
              const Child = selected.model(ChildDefinition);
              const Parent = selected.model(ParentDefinition);

              for (const name of ["relation_scope_children", "relation_scope_parents"]) {
                await db.unsafe(
                  name === "relation_scope_children"
                    ? "CREATE TEMP TABLE relation_scope_children (id INTEGER PRIMARY KEY, tenant_id INTEGER, active INTEGER) ON COMMIT DROP"
                    : "CREATE TEMP TABLE relation_scope_parents (id INTEGER PRIMARY KEY, tenant_id INTEGER, child_id INTEGER) ON COMMIT DROP",
                );
                await db.unsafe(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`);
                await db.unsafe(`ALTER TABLE ${name} FORCE ROW LEVEL SECURITY`);
                await db.unsafe(
                  `CREATE POLICY relation_scope ON ${name} USING (tenant_id = current_setting('app.tenant_id')::integer)`,
                );
              }
              await Child.create({ id: 1, tenant_id: id, active: 1 });
              await Child.create({ id: 2, tenant_id: id, active: 0 });
              await Parent.create({ id, tenant_id: id, child_id: 2 });
              const parent = await Parent.findOrFail(id);
              expect((await parent.children().get()).map((row) => row.get("tenant_id"))).toEqual([
                id,
              ]);
              expect(await parent.child().get()).toBeNull();
              const loaded = (await Parent.query().with("children", "child").get())[0];
              expect(
                loaded?.loaded<Array<{ id: unknown }>>("children")?.map((row) => row.id),
              ).toEqual([1]);
              expect(loaded?.loaded("child")).toBeUndefined();
              expect(
                (await Parent.query().whereHas("children").get()).map((row) => row.id),
              ).toEqual([id]);
              expect(await Parent.query().whereHas("child").get()).toEqual([]);
              expect((await settings(selected)).tenant).toBe(String(id));
            }),
          ),
        );
      },
      {
        repositories: [ChildRepository, ParentRepository],
        models: [ChildDefinition, ParentDefinition],
      },
    );
  });
  test("changed-field writes preserve stale edits, mutable dates and timestamp no-ops under RLS", async () => {
    type Row = {
      id: number;
      tenant_id: number;
      title: string;
      qty: number;
      metadata: { tags: string[] };
      published_at: Date;
      created_at: Date;
      updated_at: Date;
    };
    const table = defineTable<Row, "id">({
      name: "dirty_rls_items",
      primaryKey: "id",
      columns: [
        "id",
        "tenant_id",
        "title",
        "qty",
        "metadata",
        "published_at",
        "created_at",
        "updated_at",
      ],
    });
    class ItemEntity extends Model<Row, "id"> {}
    const ItemRepository = defineRepository({
      name: "ItemRepository",
      table: table,
      dependencies: [],
      create: (binding) => new BaseRepository(binding),
    });
    const ItemDefinition = defineModel({
      name: "Item",
      repository: ItemRepository,
      dependencies: [],
      attributes: {
        guarded: [],
        casts: {
          metadata: "json",
          published_at: "datetime",
          created_at: "datetime",
          updated_at: "datetime",
        },
      },
      construct: (state, binding) => new ItemEntity(state, binding),
    });

    await withRls(
      async (invoke) => {
        await Promise.all(
          [1, 2, 3].map((tenantId) =>
            tenantRun(invoke, { ...defaultTestTenant, id: tenantId }, async (selected, _policy) => {
              const db = sessionSql(selected);
              const Item = selected.model(ItemDefinition);

              await db.unsafe(
                "CREATE TEMP TABLE dirty_rls_items(id INTEGER PRIMARY KEY, tenant_id INTEGER, title TEXT, qty INTEGER, metadata JSONB, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ) ON COMMIT DROP",
              );
              await db.unsafe("ALTER TABLE dirty_rls_items ENABLE ROW LEVEL SECURITY");
              await db.unsafe("ALTER TABLE dirty_rls_items FORCE ROW LEVEL SECURITY");
              await db.unsafe(
                "CREATE POLICY tenant_rows ON dirty_rls_items USING (tenant_id = current_setting('app.tenant_id')::integer)",
              );
              await Item.create({
                id: 1,
                tenant_id: tenantId,
                title: "original",
                qty: 10,
                metadata: { tags: ["a"] },
                published_at: new Date("2026-01-01T00:00:00Z"),
              });
              const first = await Item.findOrFail(1);
              const second = await Item.findOrFail(1);
              await first.update({ title: "changed" });
              second.get("published_at").setUTCFullYear(2027);
              second.get("metadata").tags.push("b");
              await second.update({ qty: 11 });
              const persisted = await Item.findOrFail(1);
              expect(persisted.toObject()).toMatchObject({
                tenant_id: tenantId,
                title: "changed",
                qty: 11,
                metadata: { tags: ["a", "b"] },
              });
              expect(persisted.get("published_at").getUTCFullYear()).toBe(2027);
              const updated = persisted.get("updated_at").getTime();
              await db.unsafe("SELECT pg_sleep(0.005)");
              await persisted.save();
              expect((await Item.findOrFail(1)).get("updated_at").getTime()).toBe(updated);
              await persisted.update({ qty: 12 });
              expect(persisted.get("updated_at").getTime()).toBeGreaterThan(updated);
              expect((await settings(selected)).tenant).toBe(String(tenantId));
            }),
          ),
        );
      },
      { repositories: [ItemRepository], models: [ItemDefinition] },
    );
  });
});
