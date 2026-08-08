import type { CacheLike } from "../../types/services";
import { Job } from "../queue";

interface InvalidateCacheTagsPayload {
  tags: string[];
}

class InvalidateCacheTagsJob extends Job<InvalidateCacheTagsPayload> {
  constructor(private readonly cache: CacheLike) {
    super();
  }

  override async handle(payload: InvalidateCacheTagsPayload): Promise<void> {
    await this.cache.tags(...payload.tags).flush();
  }
}

export default InvalidateCacheTagsJob;
export type { InvalidateCacheTagsPayload };
