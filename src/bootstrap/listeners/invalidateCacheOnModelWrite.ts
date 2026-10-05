import { type EventBus, eventBus, modelEventName } from "@getstrata/core/events";
import type { DurableListener, SqlOutbox } from "@getstrata/core/events/outbox";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import type { Queue } from "@getstrata/core/queue";
import { createTrackedJob } from "@getstrata/core/queue/createAppQueue";
import type { CacheLike } from "../../types/services";
import { resolveApplicationCache, resolveApplicationQueue } from "../applicationRegistry";
import { cacheTagsForModelWrite, discoverModelTableNames } from "../cache/modelCacheTags";

const MODEL_WRITE_ACTIONS = ["created", "updated", "deleted", "restored", "force-deleted"] as const;
const CACHE_EVENT = "strata.cache.invalidate-tags";
interface ModelCacheInvalidationOptions {
  outbox?: SqlOutbox;
}
interface Registration {
  durable: boolean;
  suspend(): void;
  resume(): void;
  dispose(): void;
}
const STATE_KEY = Symbol.for("@getstrata/modelCacheInvalidationRegistrations");
function registrations(): WeakMap<EventBus, Registration> {
  const global = globalThis as Record<symbol, WeakMap<EventBus, Registration> | undefined>;
  global[STATE_KEY] ??= new WeakMap();
  return global[STATE_KEY];
}

function requireCacheTags(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 128 ||
    !value.every((tag) => typeof tag === "string" && tag.length > 0 && tag.length <= 256)
  )
    throw new Error("Invalid durable cache invalidation payload.");
  return value;
}

/** Include in the application's one outbox registry; never dispatch through Redis queues. */
function createModelCacheInvalidationListener(
  resolveCache: () => CacheLike = resolveApplicationCache,
): DurableListener {
  return {
    name: "strata.cache.invalidate-tags.v1",
    event: CACHE_EVENT,
    async handle(event, { signal }) {
      const payload = event.payload as { tags?: unknown } | null;
      if (event.version !== 1) throw new Error("Invalid durable cache invalidation version.");
      const tags = requireCacheTags(payload?.tags);
      signal.throwIfAborted();
      await new InvalidateCacheTagsJob(resolveCache()).handle({ tags });
      signal.throwIfAborted();
    },
  };
}

/** Durable mode requires the outbox schema and an explicit business transaction. */
function registerInvalidateCacheOnModelWriteListeners(
  bus: EventBus = eventBus,
  options: ModelCacheInvalidationOptions = {},
): () => void {
  if (options.outbox && !options.outbox.hasListener("strata.cache.invalidate-tags.v1", CACHE_EVENT))
    throw new Error("The application outbox must include createModelCacheInvalidationListener().");
  const writes = discoverModelTableNames().flatMap((tableName) =>
    MODEL_WRITE_ACTIONS.map((action) => ({
      tableName,
      action,
      tags: cacheTagsForModelWrite(tableName, action),
    })),
  );
  if (options.outbox)
    for (const write of writes) if (write.tags.length) requireCacheTags(write.tags);
  const state = registrations();
  const previous = state.get(bus);
  // Generated provider calls must not downgrade an already configured durable registrar.
  if (previous?.durable && !options.outbox) return () => {};
  previous?.suspend();
  const unsubscribe: Array<() => void> = [];
  const subscribe: Array<() => () => void> = [];
  const registration: Registration = {
    durable: !!options.outbox,
    suspend() {
      for (const stop of unsubscribe.splice(0)) stop();
    },
    resume() {
      for (const start of subscribe) unsubscribe.push(start());
      state.set(bus, registration);
    },
    dispose() {
      if (state.get(bus) !== registration) return;
      registration.suspend();
      if (previous) previous.resume();
      else state.delete(bus);
    },
  };
  for (const { tableName, action, tags: durableTags } of writes) {
    const event = modelEventName(tableName, action);
    if (options.outbox) {
      if (!durableTags.length) continue;
      const outbox = options.outbox;
      subscribe.push(() =>
        bus.listenTransactional(event, async () => {
          await outbox.publish(CACHE_EVENT, { tags: durableTags });
        }),
      );
    } else {
      // Compatibility only: existing 2.x apps must explicitly migrate to durable mode.
      subscribe.push(() =>
        bus.listen(event, async () => {
          const tags = cacheTagsForModelWrite(tableName, action);
          if (!tags.length) return;
          let cache: CacheLike;
          let queue: Queue;
          try {
            cache = resolveApplicationCache();
            queue = resolveApplicationQueue();
          } catch {
            return;
          }
          const job = createTrackedJob("cache.invalidate-tags", new InvalidateCacheTagsJob(cache));
          await queue.dispatch(job, { tags });
        }),
      );
    }
  }
  registration.resume();
  return registration.dispose;
}

export type { ModelCacheInvalidationOptions };
export { createModelCacheInvalidationListener, registerInvalidateCacheOnModelWriteListeners };
