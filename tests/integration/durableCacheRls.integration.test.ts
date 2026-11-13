import { expect, test } from "bun:test";
import { createModelCacheInvalidationListener } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
  repositoryEffects,
  type TransactionalRepositoryListener,
} from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import { createOutboxMigration } from "@getstrata/core/events/outbox";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import { enableTenantRlsSql, RLS_HELPER_SQL } from "@getstrata/core/tenant/enableTenantRls";
import { SQL } from "bun";
import { sessionSql } from "../helpers/nativePersistenceApplication";
import { withOutboxes } from "../helpers/outboxApplication";

type Organization = { id: number; name: string; tenant_id: number };
const organization = defineRepository({
  name: "rls.cache.organization",
  table: defineTable<Organization, "id">({
    name: "organization",
    primaryKey: "id",
    columns: ["id", "name", "tenant_id"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const intent =
  createServiceToken<TransactionalRepositoryListener<Organization, "id">>("test.rls.cache.intent");
const observed =
  createServiceToken<AfterCommitRepositoryListener<Organization>>("test.rls.cache.observed");

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
test.skipIf(!adminUrl || !restrictedUrl)(
  "durable generated cache listener: concurrent restricted-role HTTP requests, rollback and cache recovery",
  async () => {
    const name = `cache_outbox_${crypto.randomUUID().replaceAll("-", "")}`;
    const control = new SQL(adminUrl!);
    let admin: SQL | undefined;
    let pool: SQL | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;
    let created = false;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const a = new URL(adminUrl!);
      a.pathname = `/${name}`;
      const r = new URL(restrictedUrl!);
      r.pathname = `/${name}`;
      admin = new SQL(a.href);
      pool = new SQL({ url: r.href, max: 4 });
      const [role] = await pool.unsafe(
        "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(role.rolsuper || role.rolbypassrls).toBe(false);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.role)) throw new Error("Invalid fixture role");
      await createOutboxMigration("fixture", "pgsql", { rls: true }).up(admin);
      await admin.unsafe(
        "CREATE TABLE organization (id INTEGER PRIMARY KEY, name TEXT NOT NULL, tenant_id INTEGER NOT NULL)",
      );
      await admin.unsafe(RLS_HELPER_SQL);
      await admin.unsafe(enableTenantRlsSql("organization"));
      await admin.unsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON organization,strata_outbox_event,strata_outbox_delivery TO "${role.role}"`,
      );
      const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
      await cache.tags("organizations").remember("list", async () => "old");
      let unavailable = true;
      const tenants = [101, 102].map((id) => ({
        id,
        slug: `fixture-${id}`,
        plan: "free" as const,
        region: "eu" as const,
      }));
      const selectedAdmin = admin;
      const seen: number[] = [];
      await withOutboxes(
        [
          {
            listeners: [
              createModelCacheInvalidationListener(
                new Proxy(cache, {
                  get(target, key) {
                    if (unavailable) throw Error("Cache outage fixture");
                    const value = Reflect.get(target, key, target);
                    return typeof value === "function" ? value.bind(target) : value;
                  },
                }),
              ),
            ],
            resolveTenant: async (_selected, id) =>
              tenants.find((tenant) => tenant.id === id) ?? null,
            retryDelayMs: 1,
          },
        ],
        async (fixture) => {
          const outbox = fixture.outboxes[0];
          if (!outbox) throw Error("Missing coordinator");
          server = Bun.serve({
            port: 0,
            fetch: withJsonErrorHandling(async (request: Request) => {
              const url = new URL(request.url);
              const id = Number(url.searchParams.get("id"));
              const tenant = tenants[id % 2]!;
              return fixture.transaction(async (selected) => {
                await selected
                  .repository(organization)
                  .create({ id, name: "fixture", tenant_id: tenant.id });
                if (url.searchParams.has("fail")) throw new Error("Business rollback fixture");
                return Response.json({ tenant: tenant.id });
              }, tenant.id);
            }),
          });
          const origin = `http://localhost:${server.port}`;
          const responses = await Promise.all(
            [1, 2, 3, 4].map((id) => fetch(`${origin}/?id=${id}`)),
          );
          expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
          expect(seen.sort()).toEqual([101, 101, 102, 102]);
          expect((await fetch(`${origin}/?id=5&fail`)).status).toBe(500);
          expect(
            (await selectedAdmin.unsafe("SELECT COUNT(*)::integer AS count FROM organization"))[0]
              .count,
          ).toBe(4);
          expect(
            (
              await selectedAdmin.unsafe(
                "SELECT COUNT(*)::integer AS count FROM strata_outbox_event",
              )
            )[0].count,
          ).toBe(4);
          for (const tenant of tenants)
            await fixture.transaction(async (selected) => {
              const sql = sessionSql(selected);
              expect(
                (
                  await sql.unsafe<{ count: number }>(
                    "SELECT COUNT(*)::integer AS count FROM organization",
                  )
                )[0]!.count,
              ).toBe(2);
              expect((await sql.unsafe("SELECT tenant_id FROM strata_outbox_event")).length).toBe(
                2,
              );
              expect(
                (
                  await sql.unsafe<{ tenant_id: number }>(
                    "SELECT tenant_id FROM strata_outbox_event",
                  )
                ).every((row) => Number(row.tenant_id) === tenant.id),
              ).toBe(true);
            }, tenant.id);
          expect(await outbox.processNext()).toBe(true);
          expect(
            (
              await selectedAdmin.unsafe(
                "SELECT COUNT(*)::integer AS count FROM strata_outbox_delivery WHERE attempts=1 AND status='pending'",
              )
            )[0].count,
          ).toBe(1);
          unavailable = false;
          await Bun.sleep(10);
          for (let i = 0; i < 4; i++) expect(await outbox.processNext()).toBe(true);
          expect(await cache.get<string>("list")).toBeUndefined();
          expect(
            (
              await selectedAdmin.unsafe(
                "SELECT COUNT(*)::integer AS count FROM strata_outbox_delivery WHERE status='completed'",
              )
            )[0].count,
          ).toBe(4);
        },
        {
          connection: { driver: "pgsql", url: r.href, max: 8 },
          tenancy: "rls",
          migrate: false,
          prepare: (bindings) => {
            const binding = bindings[0];
            if (!binding) throw Error("Missing coordinator declaration");
            return {
              repositories: [organization],
              repositoryEffects: [
                repositoryEffects(organization, [
                  { action: "created", transactional: intent, afterCommit: observed },
                ]),
              ],
              services: [
                service(intent, {
                  lifetime: "application",
                  dependencies: [binding.token] as const,
                  create: (outbox) => (publication) =>
                    outbox
                      .publish(
                        publication.session,
                        "strata.cache.invalidate-tags",
                        { tags: ["organizations", "reports"] },
                        { tenantId: publication.row.tenant_id },
                      )
                      .then(() => undefined),
                }),
                service(observed, {
                  lifetime: "application",
                  dependencies: [] as const,
                  create: () => (row) => {
                    seen.push(row.tenant_id);
                  },
                }),
              ],
            };
          },
        },
      );
    } finally {
      server?.stop(true);
      await pool?.close();
      await admin?.close();
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);
