import { expect, test } from "bun:test";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import FailedJobRepository from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "@getstrata/core/queue/failedJobService";
import { grantPostgresAppRolePrivileges } from "@getstrata/core/tenant/enableTenantRls";
import { SQL } from "bun";

test("native PostgreSQL retains JSONB object storage, restricted-role replay and legacy string recovery", async () => {
  const restrictedUrl =
    process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!process.env.MIGRATION_DATABASE_URL || !restrictedUrl)
    throw new Error("Owned migration and runtime PostgreSQL URLs are required.");
  const control = new SQL({ url: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const database = `owned_failed_json_${crypto.randomUUID().replaceAll("-", "")}`;
  let owner: SQL | undefined;
  let runtime: SQL | undefined;
  let created = false;
  try {
    await control.unsafe(`CREATE DATABASE ${database}`);
    created = true;
    const adminUrl = new URL(process.env.MIGRATION_DATABASE_URL);
    adminUrl.pathname = `/${database}`;
    owner = new SQL({ url: adminUrl.href, max: 1 });
    await owner.unsafe(
      "CREATE TABLE failed_job(id SERIAL PRIMARY KEY,job_name TEXT NOT NULL,job_id TEXT,payload JSONB NOT NULL,exception TEXT NOT NULL,failed_at TIMESTAMPTZ NOT NULL)",
    );
    const runtimeUrl = new URL(restrictedUrl);
    await grantPostgresAppRolePrivileges(owner, {
      database,
      role: decodeURIComponent(runtimeUrl.username),
    });
    runtimeUrl.pathname = `/${database}`;
    runtime = new SQL({ url: runtimeUrl.href, max: 1 });
    const [identity] = await runtime.unsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    expect(identity).toEqual({ rolsuper: false, rolbypassrls: false });
    const runtimeConnection = runtime;
    const ownerConnection = owner;
    await runWithSqlDialect("pgsql", async () => {
      const repository = new FailedJobRepository().withConnection(runtimeConnection);
      const service = new FailedJobService(repository);
      const payload = {
        event: "orders.created",
        orderId: 42,
        nested: { message: "Préparation", count: 3 },
      };
      const record = await service.recordFailure({
        jobName: "owned-fixture",
        jobId: "stable-logical-id",
        payload,
        exception: "HTTP 503",
      });
      expect(record.payload).toEqual(payload);
      expect(record.failed_at).toBeInstanceOf(Date);
      const [stored] = await ownerConnection.unsafe<{ kind: string; payload: unknown }[]>(
        "SELECT jsonb_typeof(payload) AS kind,payload FROM failed_job WHERE id=$1",
        [record.id],
      );
      expect(stored?.kind).toBe("object");
      expect(stored?.payload).toEqual(payload);
      expect((await service.listRecent())[0]?.payload).toEqual(payload);
      const aliases = await repository.findAll({
        select: [{ kind: "literalText", value: "not JSON", as: "payload" }],
      });
      expect(JSON.stringify(aliases)).toBe(JSON.stringify([{ payload: "not JSON" }]));
      const [legacy] = await ownerConnection.unsafe<{ id: number }[]>(
        "INSERT INTO failed_job(job_name,payload,exception,failed_at) VALUES ('legacy',to_jsonb($1::text),'old failure',NOW()) RETURNING id",
        [JSON.stringify(payload)],
      );
      expect(legacy?.id).toBeNumber();
      if (!legacy) throw new Error("Legacy fixture insert did not return its identity.");
      expect((await repository.findByIdOrThrow(legacy.id)).payload).toEqual(payload);
      await service.retry(record.id, async (recovered) => {
        expect(recovered.job_id).toBe("stable-logical-id");
        expect(recovered.payload).toEqual(payload);
        expect((await service.listRecent()).some((item) => item.id === record.id)).toBe(true);
      });
      expect((await service.listRecent()).some((item) => item.id === record.id)).toBe(false);
      expect((await repository.findByIdOrThrow(legacy.id)).payload).toEqual(payload);
    });
  } finally {
    await runtime?.close();
    await owner?.close();
    if (created) await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await control.close();
  }
}, 15000);
