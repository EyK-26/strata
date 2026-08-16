import { type EventBus, eventBus, modelEventName } from "@getstrata/core/events";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import type { Queue } from "@getstrata/core/queue";
import { createTrackedJob } from "@getstrata/core/queue/createAppQueue";
import type { CacheLike } from "../../types/services";
import { resolveApplicationCache, resolveApplicationQueue } from "../applicationRegistry";
import { cacheTagsForModelWrite, discoverModelTableNames } from "../cache/modelCacheTags";

const MODEL_WRITE_ACTIONS = ["created", "updated", "deleted", "restored", "force-deleted"] as const;

function registerInvalidateCacheOnModelWriteListeners(bus: EventBus = eventBus): void {
  for (const tableName of discoverModelTableNames()) {
    for (const action of MODEL_WRITE_ACTIONS) {
      bus.listen(modelEventName(tableName, action), async () => {
        const tags = cacheTagsForModelWrite(tableName, action);

        if (tags.length === 0) {
          return;
        }

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
      });
    }
  }
}

export { registerInvalidateCacheOnModelWriteListeners };
