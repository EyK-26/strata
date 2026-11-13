import assert from "node:assert/strict";
import { createAppContext } from "@getstrata/bootstrap/context";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import * as Core from "@getstrata/core";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineModel,
  defineRepository,
  type ModelBinding,
  type ModelState,
  type RepositoryBinding,
} from "@getstrata/core/database/definitions";
import * as Models from "@getstrata/core/database/model";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { JobRegistry } from "@getstrata/core/queue/jobRegistry";
import {
  createIdentityQueue,
  createQueueHandoff,
  QueueHandoffError,
} from "@getstrata/core/queue/queueHandoff";
import {
  createFailedJobService,
  createSystemQueueServices,
} from "@getstrata/core/queue/queueServices";
import {
  queueInvalidKey,
  queueProcessingKey,
  queueProcessingLeaseKey,
  RedisStreamsQueue,
  RedisStreamsWorker,
  streamDeadLetterKey,
  streamQueueKey,
} from "@getstrata/core/queue/redisQueue";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { RedisClient } from "bun";

type Row = { id: number; title: string };
const Label = createServiceToken<string>("installed.bound.label");
class Notes extends BaseRepository<Row, "id"> {
  #label: string;
  constructor(binding: RepositoryBinding<Row, "id">, label: string) {
    super(binding);
    this.#label = label;
  }
  label(): string {
    return this.#label;
  }
}
class Note extends Model<Row, "id"> {
  #memo: string;
  constructor(state: ModelState<Row>, binding: ModelBinding<Row, "id", Notes>, source?: Note) {
    super(state, binding);
    this.#memo = source ? source.#memo : "private-constructor-state";
  }
  memo(): string {
    return this.#memo;
  }
}
const notes = defineRepository<Row, "id", Notes, readonly [typeof Label]>({
  name: "InstalledBoundNotes",
  table: defineTable<Row, "id">({
    name: "installed_bound_notes",
    primaryKey: "id",
    columns: ["id", "title"],
  }),
  dependencies: [Label],
  create: (binding, label) => new Notes(binding, label),
});
const note = defineModel<Row, "id", Note, Notes, readonly []>({
  name: "InstalledBoundNote",
  repository: notes,
  dependencies: [],
  attributes: { fillable: ["title"], timestamps: false },
  construct: (state, binding, source) => new Note(state, binding, source),
});

/** Installed type exclusions; deliberately never invoked. */
function excludedPublicAuthority() {
  // @ts-expect-error Internal native binding inspectors are not root public API.
  Core.getModelBinding;
  // @ts-expect-error No implicit no-argument repository constructor remains.
  new BaseRepository<Row, "id">();
  // @ts-expect-error Static Model CRUD is removed.
  Note.find(1);
}
void excludedPublicAuthority;
assert.equal(Core.BaseRepository, BaseRepository);
assert.equal(Core.Model, Model);
assert.equal("getModelBinding" in Core, false);
assert.equal("createBoundModel" in Models, false);
for (const name of [
  "snapshotModelQuery",
  "snapshotRepositoryQuery",
  "getRepositoryBinding",
  "getModelBinding",
  "modelFacade",
]) {
  assert.equal(name in Core, false);
  assert.equal(name in Models, false);
}
for (const specifier of [
  "#strata-orm-internal",
  "#strata-orm-runtime",
  "@getstrata/core/database/ormInternal",
  "@getstrata/core/database/modelRegistry",
  "@getstrata/core/database/modelQuery",
  "@getstrata/core/dist/ormRuntime.js",
]) {
  await assert.rejects(
    import(specifier),
    "Package-private native artifacts must remain unreachable to external consumers",
  );
}
const provider: ServiceProvider = {
  name: "installed.fixtures",
  register(context) {
    context.dependencies.cache = new CacheRepository(
      new SimpleCacheStore(new SimpleCache(60_000, 20)),
    );
    context.dependencies.storage = new StorageManager(
      createStorageDriver({ driver: "local", rootDirectory: "storage" }),
    );
  },
};
const contexts = await Promise.all(
  ["one", "two"].map((label) =>
    createAppContext([provider], {
      connection: "main",
      definition: {
        providers: [],
        services: [
          valueService(Label, label),
          ...createDatabaseBindings({
            default: "main",
            repositories: [notes, failedJobRepository],
            models: [note],
            connections: { main: { driver: "sqlite", filename: ":memory:" } },
          }),
        ],
      },
      http: {
        tenancy: "column",
        signatureSecret: `installed-${label}-signing-secret`,
        csrf: {
          token: {
            secret: `installed-${label}-csrf-secret-32-characters`,
            cookieName: `installed_${label}_csrf`,
            production: true,
          },
          allowDevelopmentHeaders: false,
        },
        production: true,
        allowTenantDevHeaders: false,
        metadata: () => ({
          authenticate: async () => ({
            status: "authenticated",
            user: { id: label === "one" ? 1 : 2, role: "member" },
            credentialSource: "session",
          }),
          memberships: async () => [],
          userTenantId: async () => (label === "one" ? 1 : 2),
          tenant: async (id) => ({ id, slug: label }),
        }),
      },
    }),
  ),
);
const kernels = contexts.map((context) => createHttpKernel(context.dependencies));
try {
  const sources = await Promise.all(
    contexts.map((context) =>
      context.invoke({ kind: "command" }, async ({ database }) => {
        assert.equal(database.connection("main"), database);
        assert.equal(database.repository(notes), database.repository(notes));
        assert.ok(database.repository(failedJobRepository) instanceof BaseRepository);
        await database.execute({
          text: "CREATE TABLE failed_job (id INTEGER PRIMARY KEY,job_name TEXT,job_id TEXT,handoff TEXT,payload TEXT,exception TEXT,failed_at TEXT)",
          params: [],
        });
        assert.deepEqual(
          await createFailedJobService(database).listRecent(),
          [],
          "Installed queue service must use the same original failed-job definition registered by its public artifact",
        );
        await database.execute({
          text: "CREATE TABLE installed_bound_notes (id INTEGER PRIMARY KEY, title TEXT)",
          params: [],
        });
        const entity = await database
          .model(note)
          .create({ title: `${database.repository(notes).label()}:command` });
        assert.ok(entity instanceof Model);
        assert.ok(database.repository(notes) instanceof BaseRepository);
        entity.setLoaded("old", { forbidden: "loaded source authority" });
        return entity;
      }),
    ),
  );
  for (const [index, context] of contexts.entries()) {
    const source = sources[index];
    assert.ok(source);
    await context.invoke({ kind: "command" }, ({ database }) =>
      database.transaction(async (child) => {
        const rebound = child.model(note).bind(source);
        assert.equal(rebound.memo(), "private-constructor-state");
        assert.equal(rebound.loaded("old"), undefined);
        assert.equal(child.repository(notes), child.repository(notes));
        await rebound.update({ title: `${child.repository(notes).label()}:rebound` });
      }),
    );
    const foreignSource = sources[1 - index];
    assert.ok(foreignSource);
    await context.invoke({ kind: "command" }, ({ database }) => {
      assert.throws(() => database.model(note).bind(foreignSource));
    });
    const kernel = kernels[index];
    assert.ok(kernel);
    const response = await kernel.wrapApi(async (_request, ports) => {
      const repository = ports.database.repository(notes);
      const entity = await ports.database
        .model(note)
        .create({ title: `${repository.label()}:http` });
      return Response.json({ label: repository.label(), memo: entity.memo() });
    })(new Request("http://installed.test/notes", { headers: { accept: "application/json" } }));
    assert.equal(response.status, 200);
    assert.ok(
      response.headers
        .get("set-cookie")
        ?.startsWith(`installed_${index === 0 ? "one" : "two"}_csrf=`),
    );
    assert.ok(response.headers.get("set-cookie")?.includes("; Secure"));
    assert.deepEqual(await response.json(), {
      label: index === 0 ? "one" : "two",
      memo: "private-constructor-state",
    });
    const rows = await context.invoke({ kind: "command" }, ({ database }) =>
      database.repository(notes).findAll({ orderBy: { column: "id", direction: "asc" } }),
    );
    const label = index === 0 ? "one" : "two";
    assert.deepEqual(
      rows.map((row) => row.title),
      [`${label}:rebound`, `${label}:http`],
    );
  }
  const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const overlap = await Promise.all(
    kernels.map((kernel, index) => {
      const label = index === 0 ? "one" : "two";
      const signed = absoluteTemporarySignedUrl(
        "/signed-overlap",
        60,
        {},
        "https://installed.test",
        `installed-${label}-signing-secret`,
      );
      return kernel.wrapSigned(async (_request, ports) => {
        assert.equal((await ports.auth.requireUser()).id, index + 1);
        assert.equal(ports.established.tenant?.slug, label);
        const own = entered[index];
        const other = entered[1 - index];
        assert.ok(own && other);
        own.resolve();
        await other.promise;
        return Response.json({
          label: ports.database.repository(notes).label(),
          titles: (await ports.database.repository(notes).findAll()).map((row) => row.title),
        });
      })(new Request(signed, { headers: { accept: "application/json" } }));
    }),
  );
  for (const [index, response] of overlap.entries()) {
    const label = index === 0 ? "one" : "two";
    assert.equal(response.status, 200);
    const body = (await response.json()) as { label: string; titles: string[] };
    assert.equal(body.label, label);
    assert.equal(
      body.titles.every((title: string) => title.startsWith(`${label}:`)),
      true,
    );
    const kernel = kernels[index];
    assert.ok(kernel);
    const wrong = absoluteTemporarySignedUrl(
      "/signed-overlap",
      60,
      {},
      "https://installed.test",
      `installed-${index === 0 ? "two" : "one"}-signing-secret`,
    );
    const denied = await kernel.wrapSigned(async () => {
      throw new Error("Foreign application signature must not enter handler");
    })(new Request(wrong, { headers: { accept: "application/json" } }));
    assert.equal(denied.status, 403);
  }
  // Root workers must catch the same canonical admission error thrown by granular services.
  assert.equal((Core as Record<string, unknown>).QueueHandoffError, QueueHandoffError);
  const queueContext = contexts[0];
  assert.ok(queueContext);
  const redisUrl = process.env.REDIS_URL;
  assert.ok(redisUrl, "Packed queue proof requires the configured local Redis fixture");
  const redis = new RedisClient(redisUrl);
  try {
    for (const transport of ["lists", "streams"] as const) {
      const keys = ["high", "default", "low"].map(
        (name) => `strata:packed-handoff:${crypto.randomUUID()}:${name}`,
      ) as [string, string, string];
      const handoff = createQueueHandoff({
        key: new Uint8Array(32).fill(19),
        audience: "packed-queue",
      });
      const services = createSystemQueueServices(queueContext.invoke, {}, handoff);
      const registry = new JobRegistry();
      let factories = 0;
      let handled = 0;
      class PackedJob extends Core.Job {
        async handle(_payload: object, context?: import("@getstrata/core/queue").JobContext) {
          handled++;
          assert.deepEqual(context?.actor, { kind: "principal", claims: { id: 7 } });
          assert.deepEqual(context?.tenant, { id: 1 });
          assert.ok(context?.database);
          assert.equal(context.database.repository(notes).label(), "one");
          await context.database.execute({ text: "SELECT 1", params: [] });
        }
      }
      registry.register("packed-job", () => {
        factories++;
        return new PackedJob();
      });
      const job = registry.track("packed-job", new PackedJob());
      const queue =
        transport === "lists"
          ? new Core.RedisQueue(redisUrl, registry, keys)
          : new RedisStreamsQueue(redisUrl, registry, keys);
      const worker: { processNext(): Promise<boolean>; close(): void } =
        transport === "lists"
          ? new Core.QueueWorker(
              redisUrl,
              services,
              registry,
              0,
              keys,
              { maxAttempts: 1, backoffMs: 0 },
              300,
            )
          : new RedisStreamsWorker(
              redisUrl,
              services,
              registry,
              0,
              keys,
              { maxAttempts: 1, backoffMs: 0 },
              300,
            );
      try {
        const identity = {
          actor: { kind: "principal" as const, claims: { id: 7 } },
          tenant: { id: 1 },
        };
        let producer: ReturnType<typeof createIdentityQueue> | undefined;
        await queueContext.application.run({ kind: "request", ...identity }, () => {
          producer = createIdentityQueue(queue, registry, handoff, identity);
        });
        assert.ok(producer);
        await producer.dispatch(job, {});
        assert.equal(await worker.processNext(), true);
        assert.equal(factories, 1);
        assert.equal(handled, 1);
        for (const envelope of [
          { name: "packed-job", payload: {} },
          {
            name: "packed-job",
            payload: { changed: true },
            handoff: handoff.seal("packed-job", {}, identity),
          },
          {
            name: "packed-job",
            payload: {},
            handoff: createQueueHandoff({
              key: new Uint8Array(32).fill(19),
              audience: "other-application",
            }).seal("packed-job", {}, identity),
          },
        ]) {
          if (transport === "lists") await redis.lpush(keys[1], JSON.stringify(envelope));
          else
            await redis.send("XADD", [
              streamQueueKey(keys[1]),
              "*",
              "payload",
              JSON.stringify(envelope),
            ]);
          assert.equal(await worker.processNext(), true);
        }
        assert.equal(factories, 1);
        assert.equal(handled, 1);
        assert.equal(
          transport === "lists"
            ? await redis.llen(queueInvalidKey(keys[1]))
            : Number(await redis.send("XLEN", [streamDeadLetterKey(keys[1])])),
          3,
        );
        assert.deepEqual(await services.listRecent(), []);
      } finally {
        worker.close();
        queue.close();
        for (const key of keys)
          await redis.del(
            key,
            queueProcessingKey(key),
            queueProcessingLeaseKey(key),
            queueInvalidKey(key),
            streamQueueKey(key),
            `${streamQueueKey(key)}:retries`,
            streamDeadLetterKey(key),
          );
      }
    }
  } finally {
    redis.close();
  }
  console.log(
    JSON.stringify({
      canonicalClasses: true,
      packedQueueHandoff: true,
      privateArtifactsHidden: true,
      privateStateBind: true,
      definitionIsolation: true,
      actualCommandAndHttp: true,
      overlappingHttpAndAppSecrets: true,
      paths: [
        import.meta.resolve("@getstrata/core"),
        import.meta.resolve("@getstrata/core/database/model"),
        import.meta.resolve("@getstrata/core/database/baseRepository"),
        import.meta.resolve("@getstrata/core/database/definitions"),
        import.meta.resolve("@getstrata/bootstrap/context"),
        import.meta.resolve("@getstrata/bootstrap/httpKernel"),
      ],
    }),
  );
} finally {
  kernels.forEach((kernel) => {
    kernel.dispose();
  });
  await Promise.all(contexts.map((context) => context.dispose()));
}
