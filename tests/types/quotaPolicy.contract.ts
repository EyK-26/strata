/** Checked against source and packed packages; never executed. */
import type { TenantContext, ThrottleQuotaPolicy } from "@getstrata/core";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import {
  CORE_TENANT_RESOLVER_TOKEN,
  CORE_THROTTLE_QUOTA_POLICY_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import { createThrottleMiddleware } from "@getstrata/core/http/throttleMiddleware";

export function quotaContracts(): void {
  const tenant: TenantContext = {
    id: 1,
    slug: "campus",
    metadata: { entitlement: "education", region: "anywhere" },
  };
  const policy: ThrottleQuotaPolicy = ({ tenant, maxAttempts, identity, routeTemplate }) => {
    const value: unknown = tenant?.metadata?.entitlement;
    void [identity, routeTemplate, value];
    return maxAttempts;
  };
  const container = new ServiceContainer();
  container.set(CORE_THROTTLE_QUOTA_POLICY_TOKEN, policy);
  container.set(CORE_TENANT_RESOLVER_TOKEN, async () => tenant);
  // @ts-expect-error A quota policy must return a synchronous number.
  container.set(CORE_THROTTLE_QUOTA_POLICY_TOKEN, async () => 1);
  // @ts-expect-error Resolver results must include the tenant identity.
  container.set(CORE_TENANT_RESOLVER_TOKEN, async () => ({ slug: "bad" }));
  createThrottleMiddleware({
    redisUrl: "redis://local",
    maxAttempts: 1,
    decaySeconds: 60,
    quotaPolicy: policy,
  });
  createThrottleMiddleware({
    redisUrl: "redis://local",
    maxAttempts: 1,
    decaySeconds: 60,
    // @ts-expect-error Strings are not quotas.
    quotaPolicy: () => "high",
  });
}

import { createMemoryThrottleMiddleware } from "@getstrata/core/http/memoryThrottleMiddleware";
export function boundedMemoryContracts(): void {
  const throttle = createMemoryThrottleMiddleware({
    maxAttempts: 1,
    decaySeconds: 60,
    maxBuckets: 100,
    pruneBatchSize: 4,
  });
  const retained: number = throttle.stats().retainedBuckets;
  throttle.dispose();
  void retained;
  // @ts-expect-error Capacity bounds are numeric.
  createMemoryThrottleMiddleware({ maxAttempts: 1, decaySeconds: 60, maxBuckets: "unbounded" });
}

import { createLoginThrottleMiddleware } from "@getstrata/core/http/loginThrottleMiddleware";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";
import { createRedisThrottleConsumer } from "@getstrata/core/http/throttleMiddleware";
export function redisOwnershipContracts(): void {
  const options = {
    redisUrl: "redis://local",
    maxAttempts: 1,
    decaySeconds: 60,
    commandTimeoutMs: 1000,
  };
  createThrottleMiddleware(options).dispose();
  createLoginThrottleMiddleware(options).dispose();
  createScimThrottleMiddleware(options).dispose();
  const consumer = createRedisThrottleConsumer(options);
  const closed: boolean = consumer.isDisposed();
  consumer.dispose();
  void closed;
}
