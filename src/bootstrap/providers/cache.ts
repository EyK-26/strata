import {
  type CreateCacheStoreOptions,
  createCacheStore,
  snapshotCacheStoreOptions,
} from "@getstrata/core/cache/createCacheStore";
import { CacheRepository, createGuardedCache } from "@getstrata/core/cache/repository";
import { CORE_CACHE_BACKEND_TOKEN, CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import {
  type FactoryServiceDeclaration,
  type ResourceServiceDeclaration,
  resourceService,
  service,
} from "@getstrata/core/contracts/services";
import type { ResourceSpec } from "@getstrata/core/runtime/application";

type CacheBindingOptions = Readonly<
  Omit<CreateCacheStoreOptions, "namespace"> & { namespace: string }
>;

/** One application backend and a guarded value facade for each entered execution. */
function createCacheBindings(
  options: CacheBindingOptions,
): readonly [ResourceServiceDeclaration, FactoryServiceDeclaration] {
  const snapshot = snapshotCacheStoreOptions(options, true);
  return Object.freeze([
    resourceService(CORE_CACHE_BACKEND_TOKEN, {
      lifetime: "application",
      dependencies: [] as const,
      create: (): ResourceSpec<CacheRepository> => ({
        name: "core.cache.backend",
        open: () => ({ ok: true, value: new CacheRepository(createCacheStore(snapshot)) }),
        close: (backend) => backend.close(),
      }),
    }),
    service(CORE_CACHE_TOKEN, {
      lifetime: "execution",
      dependencies: [CORE_CACHE_BACKEND_TOKEN, CORE_EXECUTION_OPERATIONS_TOKEN] as const,
      create: (backend, operations) => createGuardedCache(backend, operations),
    }),
  ] as const);
}

export type { CacheBindingOptions };
export { createCacheBindings };
