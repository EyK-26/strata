import { expect, test } from "bun:test";
import { RedisClient } from "bun";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { createDatabaseBindings } from "../../src/core/database/bindings";
import { failedJobRepository } from "../../src/core/queue/failedJobRepository";
import { Job, type JobContext } from "../../src/core/queue/index";
import { JobRegistry } from "../../src/core/queue/jobRegistry";
import { createIdentityQueue, createQueueHandoff } from "../../src/core/queue/queueHandoff";
import { createSystemQueueServices } from "../../src/core/queue/queueServices";
import {
  QueueWorker,
  queueInvalidKey,
  queueProcessingKey,
  queueProcessingLeaseKey,
  RedisQueue,
} from "../../src/core/queue/redisQueue";
import {
  RedisStreamsQueue,
  RedisStreamsWorker,
  STREAM_GROUP,
  streamDeadLetterKey,
  streamQueueKey,
  streamRetryKey,
} from "../../src/core/queue/redisStreams";
import { createApplication } from "../../src/core/runtime/application";
import { generatedRlsBootstrapSql } from "../../src/core/tenant/enableTenantRls";
import { withPostgresProvisioningFixture } from "../helpers/postgresProvisioningFixture";

const enabled = !!process.env.REDIS_URL && !!process.env.MIGRATION_DATABASE_URL;
const integration = enabled ? test : test.skip;
integration(
  "Redis list/stream handoffs restore actor/tenant in fresh SQL ownership, deny wrong tenant/owner, retry idempotently",
  async () => {
    await withPostgresProvisioningFixture(async (fixture) => {
      await fixture.admin.unsafe(
        `CREATE TABLE queue_entries(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,owner_id INTEGER NOT NULL,value INTEGER NOT NULL); INSERT INTO queue_entries VALUES(1,1,7,0),(2,1,8,0),(3,2,7,0); CREATE TABLE queue_effects(job_id TEXT PRIMARY KEY); CREATE TABLE failed_job(id SERIAL PRIMARY KEY,job_name TEXT NOT NULL,job_id TEXT,handoff TEXT,payload JSONB NOT NULL,exception TEXT NOT NULL,failed_at TIMESTAMPTZ NOT NULL)`,
      );
      await fixture.admin.unsafe(generatedRlsBootstrapSql(["queue_entries"]));
      await fixture.admin.unsafe(
        `GRANT USAGE ON SCHEMA public TO ${fixture.runtimeRole}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${fixture.runtimeRole}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${fixture.runtimeRole}`,
      );
      const url = new URL(process.env.MIGRATION_DATABASE_URL!);
      url.pathname = `/${fixture.databases[0]}`;
      url.username = fixture.runtimeRole;
      url.password = fixture.password;
      const application = createApplication({
        providers: [],
        services: createDatabaseBindings({
          default: "queue",
          connections: { queue: { driver: "pgsql", url: url.href, max: 2 } },
          repositories: [failedJobRepository],
        }),
      });
      await application.start();
      const invoke = createPersistenceInvocation(application, "queue");
      const redis = new RedisClient(process.env.REDIS_URL!);
      try {
        for (const transport of ["lists", "streams"] as const) {
          const keys = ["high", "default", "low"].map(
            (priority) => `strata:queue-identity:${crypto.randomUUID()}:${priority}`,
          ) as [string, string, string];
          const registry = new JobRegistry();
          const handoff = createQueueHandoff({
            key: new Uint8Array(32).fill(17),
            audience: `queue-${transport}`,
          });
          const services = createSystemQueueServices(invoke, {}, handoff);
          let handlerCalls = 0;
          let factories = 0;
          const logicalIds: string[] = [];
          let first = true;
          class Update extends Job<{ id: number; retry?: boolean; tenant?: number }> {
            override readonly maxAttempts = 2;
            override readonly backoffMs = 0;
            async handle(
              payload: { id: number; retry?: boolean; tenant?: number },
              context?: JobContext,
            ) {
              handlerCalls++;
              logicalIds.push(context!.jobId);
              expect(context?.actor).toEqual({ kind: "principal", claims: { id: 7 } });
              expect(context?.tenant).toEqual({ id: 1 });
              const database = context!.database!;
              const actor = context!.actor!;
              if (actor.kind !== "principal") throw new Error("principal required");
              await context!.policy!.run(
                database,
                { kind: "tenant", tenantId: payload.tenant ?? Number(context!.tenant!.id) },
                async (tx) => {
                  const inserted = await tx.execute({
                    text: "INSERT INTO queue_effects(job_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING job_id",
                    params: [context!.jobId],
                  });
                  if (inserted.length)
                    await tx.execute({
                      text: "UPDATE queue_entries SET value=value+1 WHERE id=$1 AND owner_id=$2 RETURNING id",
                      params: [payload.id, actor.claims.id],
                    });
                  if (payload.retry && first) {
                    first = false;
                    throw new Error("rollback then retry");
                  }
                },
              );
            }
          }
          registry.register("update", () => {
            factories++;
            return new Update();
          });
          const job = registry.track("update", new Update());
          const queue =
            transport === "lists"
              ? new RedisQueue(process.env.REDIS_URL!, registry, keys)
              : new RedisStreamsQueue(process.env.REDIS_URL!, registry, keys);
          const worker =
            transport === "lists"
              ? new QueueWorker(
                  process.env.REDIS_URL!,
                  services,
                  registry,
                  0,
                  keys,
                  { maxAttempts: 2, backoffMs: 0 },
                  300,
                )
              : new RedisStreamsWorker(
                  process.env.REDIS_URL!,
                  services,
                  registry,
                  0,
                  keys,
                  { maxAttempts: 2, backoffMs: 0 },
                  300,
                );
          const oldVisibility = process.env.QUEUE_VISIBILITY_MS;
          process.env.QUEUE_VISIBILITY_MS = "invalid-after-assembly";
          try {
            let producer!: ReturnType<typeof createIdentityQueue>;
            await application.run(
              {
                kind: "request",
                actor: { kind: "principal", claims: { id: 7 } },
                tenant: { id: 1 },
              },
              () => {
                producer = createIdentityQueue(queue, registry, handoff, {
                  actor: { kind: "principal", claims: { id: 7 } },
                  tenant: { id: 1 },
                });
              },
            );
            await producer.dispatch(job, { id: 1, retry: true });
            expect(await worker.processNext()).toBe(true);
            if (transport === "streams") expect(await worker.processNext()).toBe(true);
            expect(handlerCalls).toBe(2);
            expect(logicalIds[0]).toBe(logicalIds[1]);
            await queue.replay(job, { id: 1, retry: true }, logicalIds[0]!, {
              handoff: handoff.seal(
                "update",
                { id: 1, retry: true },
                { actor: { kind: "principal", claims: { id: 7 } }, tenant: { id: 1 } },
              ),
            });
            expect(await worker.processNext()).toBe(true);
            expect(handlerCalls).toBe(3);
            await producer.dispatch(job, { id: 2 });
            await producer.dispatch(job, { id: 3 });
            expect(await worker.processNext()).toBe(true);
            expect(await worker.processNext()).toBe(true);
            const beforeBad = handlerCalls;
            const beforeBadFactories = factories;
            const trustedIdentity = {
              actor: { kind: "principal" as const, claims: { id: 7 } },
              tenant: { id: 1 },
            };
            const rawEnvelopes = [
              { name: "update", payload: { id: 1 } },
              {
                name: "update",
                payload: { id: 1 },
                handoff: handoff.seal("update", { id: 3 }, trustedIdentity),
              },
              {
                name: "update",
                payload: { id: 1 },
                handoff: createQueueHandoff({
                  key: new Uint8Array(32).fill(17),
                  audience: "wrong-application",
                }).seal("update", { id: 1 }, trustedIdentity),
              },
            ];
            for (const envelope of rawEnvelopes) {
              const raw = JSON.stringify(envelope);
              if (transport === "lists") await redis.lpush(keys[1], raw);
              else await redis.send("XADD", [streamQueueKey(keys[1]), "*", "payload", raw]);
              expect(await worker.processNext()).toBe(true);
            }
            expect(handlerCalls).toBe(beforeBad);
            expect(factories).toBe(beforeBadFactories);
            if (transport === "lists") {
              expect(await redis.llen(queueInvalidKey(keys[1]))).toBe(3);
              expect(await redis.llen(queueProcessingKey(keys[1]))).toBe(0);
            } else {
              expect(Number(await redis.send("XLEN", [streamDeadLetterKey(keys[1])]))).toBe(3);
              const pending = await redis.send("XPENDING", [streamQueueKey(keys[1]), STREAM_GROUP]);
              expect(Array.isArray(pending) ? Number(pending[0]) : -1).toBe(0);
            }
            const values = await fixture.admin.unsafe(
              "SELECT value FROM queue_entries ORDER BY id",
            );
            expect(values.map((row: { value: number }) => row.value)).toEqual([
              transport === "lists" ? 1 : 2,
              0,
              0,
            ]);
            expect(await services.listRecent()).toEqual([]);
            let failing = true;
            let recoveryRuns = 0;
            class Recovery extends Job {
              override readonly maxAttempts = 1;
              async handle(payload: object, context?: JobContext) {
                recoveryRuns++;
                expect(payload).toEqual({ longer: 1, a: { z: 2, b: 3 } });
                expect(context?.actor).toEqual(trustedIdentity.actor);
                if (failing) throw new Error("queue recovery sentinel");
              }
            }
            registry.register("recovery", () => new Recovery());
            const recovery = registry.track("recovery", new Recovery());
            await producer.dispatch(recovery, { longer: 1, a: { z: 2, b: 3 } });
            expect(await worker.processNext()).toBe(true);
            const [stored] = await services.listRecent();
            if (!stored?.job_id || !stored.handoff)
              throw new Error("Missing trusted failure recovery identity");
            failing = false;
            await services.retry(stored.id, async (record) => {
              if (!record.job_id || !record.handoff) throw new Error("Missing replay metadata");
              await queue.replay(recovery, record.payload, record.job_id, {
                handoff: record.handoff,
              });
            });
            expect(await worker.processNext()).toBe(true);
            expect(recoveryRuns).toBe(2);
            expect(await services.listRecent()).toEqual([]);
          } finally {
            if (oldVisibility === undefined) delete process.env.QUEUE_VISIBILITY_MS;
            else process.env.QUEUE_VISIBILITY_MS = oldVisibility;
            worker.close();
            queue.close();
            for (const key of keys)
              await redis.del(
                key,
                queueProcessingKey(key),
                queueProcessingLeaseKey(key),
                queueInvalidKey(key),
                streamQueueKey(key),
                streamRetryKey(key),
                streamDeadLetterKey(key),
              );
          }
        }
        expect(
          (await fixture.admin.unsafe("SELECT count(*)::int AS count FROM queue_effects"))[0].count,
        ).toBe(6);
      } finally {
        redis.close();
        expect((await application.stop()).successful).toBe(true);
      }
    });
  },
  30000,
);
