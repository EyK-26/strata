import { cacheTagsForModelWrite, discoverModelTableNames } from "../../core/cache/modelCacheTags";
import { type EventBus, eventBus, modelEventName } from "../../core/events";
import InvalidateCacheTagsJob from "../../core/jobs/invalidateCacheTagsJob";
import { createTrackedJob } from "../../core/queue/createAppQueue";
import { resolveApplicationCache, resolveApplicationQueue } from "../applicationRegistry";

const MODEL_WRITE_ACTIONS = ["created", "updated", "deleted", "restored", "force-deleted"] as const;

function registerInvalidateCacheOnModelWriteListeners(bus: EventBus = eventBus): void {
  for (const tableName of discoverModelTableNames()) {
    for (const action of MODEL_WRITE_ACTIONS) {
      bus.listen(modelEventName(tableName, action), async () => {
        const tags = cacheTagsForModelWrite(tableName, action);

        if (tags.length === 0) {
          return;
        }

        const cache = resolveApplicationCache();
        const queue = resolveApplicationQueue();
        const job = createTrackedJob("cache.invalidate-tags", new InvalidateCacheTagsJob(cache));

        await queue.dispatch(job, { tags });
      });
    }
  }
}

export { registerInvalidateCacheOnModelWriteListeners };
