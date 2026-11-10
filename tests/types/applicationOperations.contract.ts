/** Compiled in source and installed consumers; never executed. */

import { createCachedJson } from "@getstrata/bootstrap/cachedJson";
import {
  type CacheBindingOptions,
  createCacheBindings,
} from "@getstrata/bootstrap/providers/cache";
import {
  type ExecutionOperations as RootCapability,
  CORE_EXECUTION_OPERATIONS_TOKEN as RootOperations,
} from "@getstrata/core";
import type { createGuardedCache } from "@getstrata/core/cache/repository";
import {
  CORE_EXECUTION_OPERATIONS_TOKEN,
  type ExecutionOperations,
} from "@getstrata/core/contracts/executionOperations";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken, type ServiceToken } from "@getstrata/core/contracts/token";
import {
  conditionalJsonResponse,
  type JsonResponsePolicy,
} from "@getstrata/core/http/conditionalResponse";
import type { CommandScope, ExecutionTaskOutcome } from "@getstrata/core/runtime/application";

export function operationContracts(
  scope: CommandScope,
  options: CacheBindingOptions,
  policy: JsonResponsePolicy,
  cache: ReturnType<typeof createGuardedCache>,
) {
  const operations: ExecutionOperations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
  const root: RootCapability = scope.resolve(RootOperations);
  const token: ServiceToken<ExecutionOperations> = RootOperations;
  const value: Promise<number> = operations.operation(() => 7);
  const asyncValue: Promise<string> = operations.operation(async () => "text");
  operations.assertActive();
  void [root, token, value, asyncValue];
  const sameOperation = operations.operation;
  const sameAssertion = operations.assertActive;
  // @ts-expect-error Operations preserve their readonly kernel-owned method identity.
  operations.operation = sameOperation;
  // @ts-expect-error Active assertion method identity is readonly too.
  operations.assertActive = sameAssertion;
  // @ts-expect-error Operation work is required.
  operations.operation();
  // @ts-expect-error Work must be callable.
  operations.operation(1);
  // @ts-expect-error Operations expose no implicit new CommandScope argument.
  operations.operation((child: CommandScope) => child);
  // @ts-expect-error Explicit body payload must match the callback result.
  operations.operation<string>(() => 7);
  // @ts-expect-error Operation observes own body value; it is not a spawn subtree outcome.
  const outcome: Promise<ExecutionTaskOutcome<number>> = operations.operation(() => 7);
  void outcome;
  // @ts-expect-error There is no operation timeout/detached/options overload.
  operations.operation(() => 7, { detached: true });
  // @ts-expect-error Capability does not expose universal resolution.
  operations.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
  // @ts-expect-error Capability does not expose resource acquisition.
  operations.acquire({ name: "hidden", open: () => ({ ok: true, value: 1 }), close() {} });
  // @ts-expect-error Canonical token remains invariant in payload type.
  const widened: ServiceToken<ExecutionOperations | number> = CORE_EXECUTION_OPERATIONS_TOKEN;
  void widened;
  const Dependency = createServiceToken<ExecutionOperations>("operations dependency");
  service(Dependency, {
    lifetime: "execution",
    dependencies: [CORE_EXECUTION_OPERATIONS_TOKEN],
    create: (capability) => capability,
  });
  createCacheBindings(options);
  createCacheBindings({
    driver: "array",
    ttlMs: 1000,
    maxEntries: 8,
    namespace: "explicit",
    redis: undefined,
    redisUrl: undefined,
  });
  // @ts-expect-error Canonical bindings require an explicit full namespace.
  createCacheBindings({ driver: "array", ttlMs: 1000, maxEntries: 8 });
  // @ts-expect-error Driver capability is array or redis, not an unknown spelling.
  createCacheBindings({ driver: "other", ttlMs: 1000, maxEntries: 8, namespace: "explicit" });
  // @ts-expect-error Required binding settings are readonly snapshots at the API boundary.
  options.namespace = "changed";
  const helper = createCachedJson(cache, policy);
  const response: Promise<Response> = helper(
    "key",
    async () => ({ count: 1 }),
    ["tag"],
    new Request("http://example.test"),
  );
  void response;
  // @ts-expect-error The canonical helper requires explicit response policy.
  createCachedJson(cache);
  // @ts-expect-error Old dependency-container helper construction is confined to private legacy adapter.
  createCachedJson({ cache }, policy);
  // @ts-expect-error Policy is explicitly boolean.
  createCachedJson(cache, { etagEnabled: "false" });
  // @ts-expect-error Policy is immutable at its API boundary.
  policy.etagEnabled = false;
  conditionalJsonResponse(undefined, {}, policy, { status: 201 });
  // @ts-expect-error Canonical response path cannot omit explicit policy.
  conditionalJsonResponse(undefined, {});
  // @ts-expect-error Legacy third-position response init cannot bypass explicit policy.
  conditionalJsonResponse(undefined, {}, { status: 201 });
  const tagged = cache.tags("a", "b");
  const remembered: Promise<number> = tagged.remember("key", async () => 7);
  const flushed: Promise<number> = tagged.flush();
  void [remembered, flushed];
  // @ts-expect-error Scoped cache facade exposes no backend close authority.
  cache.close();
  // @ts-expect-error CacheLike adds no raw backend set mutation capability.
  cache.set("key", 1);
}
