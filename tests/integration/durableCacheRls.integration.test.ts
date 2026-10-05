import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
} from "@getstrata/bootstrap/discoverModules";
import {
  createModelCacheInvalidationListener,
  registerInvalidateCacheOnModelWriteListeners,
} from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { defineTable } from "@getstrata/core/database/table";
import { eventBus } from "@getstrata/core/events";
import { createOutboxMigration, SqlOutbox } from "@getstrata/core/events/outbox";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import { enableTenantRlsSql, RLS_HELPER_SQL } from "@getstrata/core/tenant/enableTenantRls";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
test.skipIf(!adminUrl || !restrictedUrl)(
  "durable generated cache listener: concurrent restricted-role HTTP requests, rollback and cache recovery",
  async () => {
    const name = `cache_outbox_${crypto.randomUUID().replaceAll("-", "")}`;
    const control = new SQL(adminUrl!);
    const previous = getBoundDatabaseConnection();
    const previousPool = getDefaultDatabasePool();
    const tenancy = process.env.TENANCY_DRIVER;
    let admin: SQL | undefined;
    let pool: SQL | undefined;
    let dispose: (() => void) | undefined;
    let stop: (() => void) | undefined;
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
      registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
      bindDatabaseConnection(pool);
      useSqlDialect("pgsql");
      process.env.TENANCY_DRIVER = "rls";
      resetDiscoverModulesForTests();
      configureModulesDirectory(join(import.meta.dir, "../fixtures/discover-modules"));
      await ensureModulesLoaded();
      const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
      await cache.tags("organizations").remember("list", async () => "old");
      let unavailable = true;
      const tenants = [101, 102].map((id) => ({
        id,
        slug: `fixture-${id}`,
        plan: "free" as const,
        region: "eu" as const,
      }));
      const outbox = new SqlOutbox({
        listeners: [
          createModelCacheInvalidationListener(() => {
            if (unavailable) throw new Error("Cache outage fixture");
            return cache;
          }),
        ],
        resolveTenant: async (id) => tenants.find((t) => t.id === id) ?? null,
        retryDelayMs: 1,
      });
      dispose = registerInvalidateCacheOnModelWriteListeners(eventBus, { outbox });
      const seen: number[] = [];
      stop = eventBus.listen("organization.created", () => {
        seen.push(currentTenant()!.id);
      });
      const repository = new BaseRepository(
        defineTable<{ id: number; name: string; tenant_id: number }, "id">({
          name: "organization",
          primaryKey: "id",
          columns: ["id", "name", "tenant_id"],
        }),
      );
      server = Bun.serve({
        port: 0,
        fetch: withJsonErrorHandling(async (request: Request) => {
          const url = new URL(request.url);
          const id = Number(url.searchParams.get("id"));
          const tenant = tenants[id % 2]!;
          return runWithTenantDatabase(tenant, async () => {
            await repository.create({ id, name: "fixture", tenant_id: tenant.id });
            if (url.searchParams.has("fail")) throw new Error("Business rollback fixture");
            return Response.json({ tenant: currentTenant()!.id });
          });
        }),
      });
      const origin = `http://localhost:${server.port}`;
      const responses = await Promise.all([1, 2, 3, 4].map((id) => fetch(`${origin}/?id=${id}`)));
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      expect(seen.sort()).toEqual([101, 101, 102, 102]);
      expect((await fetch(`${origin}/?id=5&fail`)).status).toBe(500);
      expect(
        (await admin.unsafe("SELECT COUNT(*)::integer AS count FROM organization"))[0].count,
      ).toBe(4);
      expect(
        (await admin.unsafe("SELECT COUNT(*)::integer AS count FROM strata_outbox_event"))[0].count,
      ).toBe(4);
      for (const tenant of tenants)
        await runWithTenantDatabase(tenant, async () => {
          expect(
            (
              await db.unsafe<{ count: number }>(
                "SELECT COUNT(*)::integer AS count FROM organization",
              )
            )[0]!.count,
          ).toBe(2);
          expect((await db.unsafe("SELECT tenant_id FROM strata_outbox_event")).length).toBe(2);
          expect(
            (
              await db.unsafe<{ tenant_id: number }>("SELECT tenant_id FROM strata_outbox_event")
            ).every((row) => Number(row.tenant_id) === tenant.id),
          ).toBe(true);
        });
      expect(await outbox.processNext()).toBe(true);
      expect(
        (
          await admin.unsafe(
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
          await admin.unsafe(
            "SELECT COUNT(*)::integer AS count FROM strata_outbox_delivery WHERE status='completed'",
          )
        )[0].count,
      ).toBe(4);
    } finally {
      server?.stop(true);
      stop?.();
      dispose?.();
      registerDefaultDatabasePool(previousPool);
      if (previous) bindDatabaseConnection(previous);
      else resetBoundDatabaseConnection();
      resetSqlDialect();
      if (tenancy === undefined) delete process.env.TENANCY_DRIVER;
      else process.env.TENANCY_DRIVER = tenancy;
      await pool?.close();
      await admin?.close();
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);
