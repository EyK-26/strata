import { createServiceToken } from "@getstrata/core/contracts/token";
import type { CacheLike } from "../../types/services";

/** One canonical identity across root, cache, service-token and bootstrap entrypoints. */
const CORE_CACHE_TOKEN = createServiceToken<CacheLike>("core.cache");

export type { CacheLike };
export { CORE_CACHE_TOKEN };
