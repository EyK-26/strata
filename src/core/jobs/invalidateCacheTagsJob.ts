import type { CacheLike } from "../../types/services";
import { Job, type JobContext } from "../queue";

interface InvalidateCacheTagsPayload {
  tags: string[];
}

class InvalidateCacheTagsJob extends Job<InvalidateCacheTagsPayload> {
  static override readonly jobName = "cache.invalidate-tags";
  constructor(private readonly cache?: CacheLike) {
    super();
  }

  override async handle(payload: InvalidateCacheTagsPayload, context?: JobContext): Promise<void> {
    const cache = this.cache ?? context?.cache;
    if (!cache) throw new Error("Cache invalidation requires an explicit invocation cache.");
    await cache.tags(...payload.tags).flush();
  }
}

export { InvalidateCacheTagsJob };
export default InvalidateCacheTagsJob;
export type { InvalidateCacheTagsPayload };
