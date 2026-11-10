import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import * as Bootstrap from "@getstrata/bootstrap";
import { createCachedJson } from "@getstrata/bootstrap/cachedJson";
import { createCacheBindings } from "@getstrata/bootstrap/providers/cache";
import * as Core from "@getstrata/core";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";
import {
  CORE_EXECUTION_CONTEXT_TOKEN,
  type ExecutionContext,
} from "@getstrata/core/contracts/executionContext";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import { type CommandScope, createApplication } from "@getstrata/core/runtime/application";

assert.equal(Core.CORE_EXECUTION_OPERATIONS_TOKEN, CORE_EXECUTION_OPERATIONS_TOKEN);
assert.equal(Core.CORE_CACHE_TOKEN, CORE_CACHE_TOKEN);
assert.equal("CORE_CACHE_BACKEND_TOKEN" in Bootstrap, false);
const paths = [];
for (const entry of [
  "@getstrata/core",
  "@getstrata/core/contracts/executionOperations",
  "@getstrata/core/runtime/application",
  "@getstrata/core/cache/tokens",
  "@getstrata/bootstrap",
  "@getstrata/bootstrap/providers/cache",
  "@getstrata/bootstrap/cachedJson",
]) {
  const path = await realpath(new URL(import.meta.resolve(entry)));
  assert.ok(path.startsWith(`${process.cwd()}/node_modules/@getstrata/`), path);
  paths.push(path);
}
// Constructing unused Redis declarations must not require a reachable Redis server.
const unused = createCacheBindings({
  driver: "redis",
  namespace: "packed:unused:",
  redisUrl: "redis://127.0.0.1:1",
  ttlMs: 1000,
  maxEntries: 10,
});
assert.ok(Object.isFrozen(unused));
assert.ok(unused.every(Object.isFrozen));

let release!: () => void;
let entered!: () => void;
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
const started = new Promise<void>((resolve) => {
  entered = resolve;
});
const events: string[] = [];
const Resource = Core.createServiceToken<object>("packed loader resource");
const app = createApplication({
  providers: [],
  services: [
    ...Bootstrap.createCacheBindings({
      driver: "array",
      namespace: "packed:actual:",
      ttlMs: 60000,
      maxEntries: 10,
    }),
    Core.resourceService(Resource, {
      lifetime: "execution",
      dependencies: [],
      create: () => ({
        name: "packed loader resource",
        open: () => {
          events.push("open");
          return { ok: true, value: {} };
        },
        close: () => {
          events.push("close");
        },
      }),
    }),
  ],
});
let settled = false;
let nested: unknown;
let run: Promise<unknown> | undefined;
try {
  await app.start();
  run = app
    .run((scope) => {
      scope.resolve(Resource);
      const cache = scope.resolve(CORE_CACHE_TOKEN);
      const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      operations.assertActive();
      void cache.remember("actual", async () => {
        events.push("loader");
        entered();
        await gate;
        nested = await cache.remember("nested", async () => 19);
        return 23;
      });
    })
    .then((value) => {
      settled = true;
      return value;
    });
  await started;
  assert.equal(settled, false);
  assert.deepEqual(events, ["open", "loader"]);
  release();
  await run;
  assert.equal(nested, 19);
  assert.deepEqual(events, ["open", "loader", "close"]);
} finally {
  release();
  await run;
  await app.stop();
}

function handoffDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const sourceRelease = handoffDeferred();
const jobRelease = handoffDeferred();
const jobReady = handoffDeferred();
const handoffEvents: string[] = [];
type HandoffHandle = { closed: boolean; read(): string };
const HandoffResource = Core.createServiceToken<HandoffHandle>("packed handoff execution");
const handoff = createApplication({
  providers: [],
  services: [
    ...createCacheBindings({
      driver: "array",
      namespace: "packed:handoff:",
      ttlMs: 60000,
      maxEntries: 10,
    }),
    Core.resourceService(HandoffResource, {
      lifetime: "execution",
      dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
      create(context) {
        const label = context.kind;
        const handle: HandoffHandle = {
          closed: false,
          read() {
            if (this.closed) throw new Error("packed handoff handle was closed");
            return `alive:${label}`;
          },
        };
        return {
          name: "packed handoff execution",
          open() {
            handoffEvents.push(`${label}.open`);
            return { ok: true, value: handle };
          },
          close() {
            handle.closed = true;
            handoffEvents.push(`${label}.close`);
          },
        };
      },
    }),
  ],
});
let sourceRun: Promise<string> | undefined;
let sourceObservation: Promise<void> | undefined;
let handedOffJob: Promise<string> | undefined;
let jobObservation:
  | Promise<{ ok: true; value: string } | { ok: false; error: unknown }>
  | undefined;
let sourceContext: ExecutionContext | undefined;
let jobContext: ExecutionContext | undefined;
let savedSourceScope: CommandScope | undefined;
let sourceHandle: HandoffHandle | undefined;
let jobHandle: HandoffHandle | undefined;
let sourceOperationError: unknown;
let sourceCacheError: unknown;
let targetSetupError: unknown;
let jobSettled = false;
let targetValueBefore: unknown;
let targetValueAfter: unknown;
let capturedHandleUse: unknown;
let handoffReport: Record<string, unknown> | undefined;
try {
  await handoff.start();
  sourceRun = handoff.run(
    {
      kind: "request",
      externalId: "packed-source",
      actor: { kind: "principal", claims: { subject: "packed-request-user" } },
      tenant: { id: "source-tenant" },
    },
    async (source) => {
      sourceContext = source.context;
      savedSourceScope = source;
      sourceHandle = source.resolve(HandoffResource);
      const sourceCache = source.resolve(CORE_CACHE_TOKEN);
      const sourceOperations = source.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      // Admit NEW work before returning the request; retain the ORIGINAL run Promise.
      handedOffJob = handoff.run(
        {
          kind: "job",
          externalId: "packed-target",
          actor: { kind: "system", policy: "packed-handoff" },
          tenant: { id: "job-tenant" },
        },
        async (job) => {
          const targetCache = job.resolve(CORE_CACHE_TOKEN);
          try {
            jobContext = job.context;
            jobHandle = job.resolve(HandoffResource);
            job.resolve(CORE_EXECUTION_OPERATIONS_TOKEN).assertActive();
            try {
              sourceOperations.assertActive();
            } catch (error) {
              sourceOperationError = error;
            }
            try {
              await sourceCache.get("handoff-value");
            } catch (error) {
              sourceCacheError = error;
            }
            targetValueBefore = await targetCache.remember("handoff-value", async () => 41);
          } catch (error) {
            targetSetupError = error;
          } finally {
            jobReady.resolve();
          }
          await jobRelease.promise;
          capturedHandleUse = jobHandle?.read();
          targetValueAfter = await targetCache.get("handoff-value");
          handoffEvents.push("job.body.end");
          return "job-result";
        },
      );
      jobObservation = handedOffJob.then(
        (value) => {
          jobSettled = true;
          jobReady.resolve();
          return { ok: true as const, value };
        },
        (error: unknown) => {
          jobSettled = true;
          jobReady.resolve();
          return { ok: false as const, error };
        },
      );
      await sourceRelease.promise;
      handoffEvents.push("request.body.end");
      return "request-result";
    },
  );
  // Also unblock exterior observation if source initialization/admission unexpectedly fails.
  sourceObservation = sourceRun.then(
    () => jobReady.resolve(),
    () => jobReady.resolve(),
  );
  await jobReady.promise;
  assert.equal(targetSetupError, undefined);
  assert.ok(sourceContext);
  assert.ok(jobContext);
  assert.equal(sourceContext.applicationId, jobContext.applicationId);
  assert.notEqual(sourceContext, jobContext);
  assert.notEqual(sourceContext.executionId, jobContext.executionId);
  assert.notEqual(sourceContext.signal, jobContext.signal);
  assert.notEqual(sourceHandle, jobHandle);
  assert.deepEqual(jobContext.actor, { kind: "system", policy: "packed-handoff" });
  assert.deepEqual(jobContext.tenant, { id: "job-tenant" });
  assert.equal(
    (sourceOperationError as { code?: string } | undefined)?.code,
    "APPLICATION_SCOPE_EXPIRED",
  );
  assert.equal(
    (sourceCacheError as { code?: string } | undefined)?.code,
    "APPLICATION_SCOPE_EXPIRED",
  );
  assert.equal(
    sourceHandle?.closed,
    false,
    "wrong-run facade rejection is checked while source body is live",
  );
  assert.equal(targetValueBefore, 41, "job resolves its own working guarded cache");
  assert.equal(jobSettled, false);
  sourceRelease.resolve();
  const sourceResult = await sourceRun;
  assert.equal(sourceResult, "request-result");
  assert.equal(sourceHandle?.closed, true);
  assert.equal(jobHandle?.closed, false);
  assert.equal(jobSettled, false, "request cleanup must not join independently admitted job");
  assert.deepEqual(handoffEvents, [
    "request.open",
    "job.open",
    "request.body.end",
    "request.close",
  ]);
  assert.throws(() => savedSourceScope?.resolve(HandoffResource), {
    code: "APPLICATION_SCOPE_EXPIRED",
  });
  jobRelease.resolve();
  const jobOutcome = await jobObservation;
  assert.deepEqual(jobOutcome, { ok: true, value: "job-result" });
  assert.equal(capturedHandleUse, "alive:job");
  assert.equal(targetValueAfter, 41);
  assert.equal(jobHandle?.closed, true);
  assert.deepEqual(handoffEvents, [
    "request.open",
    "job.open",
    "request.body.end",
    "request.close",
    "job.body.end",
    "job.close",
  ]);
  assert.equal((await handoff.stop()).successful, true);
  handoffReport = {
    sourceResult,
    jobOutcome,
    targetValueBefore,
    targetValueAfter,
    capturedHandleUse,
    freshExecution: sourceContext.executionId !== jobContext.executionId,
    actor: jobContext.actor,
    tenant: jobContext.tenant,
    lifecycle: handoffEvents,
  };
} finally {
  sourceRelease.resolve();
  jobRelease.resolve();
  await Promise.allSettled([sourceRun, sourceObservation, handedOffJob, jobObservation]);
  await handoff.stop();
  await handoff.completion;
}

const fake = new CacheRepository(
  createCacheStore({ driver: "array", namespace: "packed:fake:", ttlMs: 60000, maxEntries: 10 }),
);
let fakeCalls = 0;
const remember = fake.remember.bind(fake);
fake.remember = (key, loader, ttl) => {
  fakeCalls++;
  return remember(key, loader, ttl);
};
const override = createApplication({
  providers: [],
  services: createCacheBindings({
    driver: "array",
    namespace: "packed:override:",
    ttlMs: 60000,
    maxEntries: 10,
  }),
  overrides: [Core.valueService(CORE_CACHE_TOKEN, fake)],
});
let identity = false;
let responses: Response[] = [];
let loads = 0;
try {
  await override.start();
  await override.run(async (scope) => {
    const cache = scope.resolve(CORE_CACHE_TOKEN);
    identity = cache === fake;
    const policy = { etagEnabled: true };
    const json = createCachedJson(cache, policy);
    policy.etagEnabled = false;
    const first = await json(
      "json",
      async () => {
        loads++;
        return { answer: 42 };
      },
      [],
      new Request("http://packed.test"),
    );
    const second = await json(
      "json",
      async () => {
        loads++;
        return { answer: 0 };
      },
      [],
      new Request("http://packed.test", {
        headers: { "If-None-Match": first.headers.get("etag") ?? "missing" },
      }),
    );
    const disabled = await Bootstrap.createCachedJson(cache, { etagEnabled: false })(
      "json",
      async () => ({}),
      [],
      new Request("http://packed.test"),
    );
    responses = [first, second, disabled];
  });
  assert.equal(identity, true);
  assert.equal(fakeCalls, 3, "installed helper must invoke actual overridden cache");
  assert.equal(loads, 1);
  assert.equal(responses[0]?.status, 200);
  assert.ok(responses[0]?.headers.get("etag"));
  assert.equal(responses[0]?.headers.get("cache-control"), "private, must-revalidate");
  assert.match(responses[0]?.headers.get("vary") ?? "", /Authorization/i);
  assert.match(responses[0]?.headers.get("vary") ?? "", /X-Tenant-Id/i);
  assert.equal(responses[1]?.status, 304);
  assert.equal(await responses[1]?.text(), "");
  assert.equal(responses[2]?.headers.get("etag"), null);
  assert.deepEqual(await responses[0]?.json(), { answer: 42 });
} finally {
  await override.stop();
  await fake.close();
}
console.log(
  JSON.stringify({
    operationIdentity: true,
    canonicalBindings: true,
    actualLoaderJoined: true,
    handoff: handoffReport,
    fakeCalls,
    loads,
    responseStatuses: responses.map((response) => response.status),
    paths,
  }),
);
