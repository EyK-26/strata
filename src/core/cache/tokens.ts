import { createServiceToken } from "@getstrata/core/contracts/token";
import type { CacheLike } from "../../types/services";
import type { CacheRepository } from "./repository";

/** One canonical identity across root, cache, service-token and bootstrap entrypoints. */
const CORE_CACHE_TOKEN = createServiceToken<CacheLike>("core.cache");
/** Internal application backend; execution consumers depend on CORE_CACHE_TOKEN. */
const CORE_CACHE_BACKEND_TOKEN = createServiceToken<CacheRepository>("core.cache.backend");

export type { CacheLike };
export { CORE_CACHE_BACKEND_TOKEN, CORE_CACHE_TOKEN };
