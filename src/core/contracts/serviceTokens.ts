import { createServiceToken } from "@getstrata/core/contracts/token";
import type { AbilityChecker } from "../auth/abilityChecker";
import type { AuthReader } from "../auth/authReader";
import type { PolicyGate } from "../auth/policy";
import type { EventBus } from "../events/eventBusClass";
import type { ThrottleQuotaPolicy } from "../http/throttleMiddleware";
import type { MailSender } from "../mail/mailer";
import type { Queue } from "../queue/index";
import type { QueueServices } from "../queue/queueServices";
import type { StorageManager } from "../storage/storage";
import type { PublicTenancyOptions, TenantResolver } from "../tenant/tenantMiddleware";
import type { TracingRuntime } from "../tracing/otel";
import type { AuthAccountLookup } from "./authUserDirectory";
import type { ConfigStoreLike, ServiceContainerLike } from "./container";

export { CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";

const CORE_THROTTLE_QUOTA_POLICY_TOKEN = createServiceToken<ThrottleQuotaPolicy>(
  "core.throttleQuotaPolicy",
);
const CORE_PUBLIC_TENANCY_TOKEN = createServiceToken<PublicTenancyOptions>("core.publicTenancy");
const CORE_TENANT_RESOLVER_TOKEN = createServiceToken<TenantResolver>("core.tenantResolver");

const CORE_HTTP_CLEANUP_TOKEN =
  createServiceToken<(cleanup: () => void) => void>("core.httpCleanup");

const CORE_TRACING_RUNTIME_TOKEN = createServiceToken<TracingRuntime>("core.tracingRuntime");

const CORE_MAIL_TOKEN = createServiceToken<MailSender>("core.mail");
const CORE_STORAGE_TOKEN = createServiceToken<StorageManager>("core.storage");
const CORE_JSON_RESPONSE_POLICY_TOKEN =
  createServiceToken<Readonly<{ etagEnabled: boolean }>>("core.jsonResponsePolicy");

const CORE_CONFIG_TOKEN = createServiceToken<ConfigStoreLike>("core.config");
const FAILED_JOB_SERVICE_TOKEN = createServiceToken<QueueServices>("core.failedJobs");
const CORE_QUEUE_TOKEN = createServiceToken<Queue>("core.queue");
const CORE_EVENT_BUS_TOKEN = createServiceToken<EventBus>("core.eventBus");
const CORE_POLICY_GATE_TOKEN =
  createServiceToken<Pick<PolicyGate, "allows" | "authorize" | "register">>("core.policyGate");
const CORE_AUTH_TOKEN = createServiceToken<AuthReader>("core.auth");
const CORE_ABILITY_CHECKER_TOKEN = createServiceToken<AbilityChecker>("core.abilityChecker");
const CORE_AUTH_USER_DIRECTORY_TOKEN =
  createServiceToken<AuthAccountLookup>("core.authUserDirectory");

function isAbilityChecker(value: unknown): value is AbilityChecker {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as AbilityChecker;

  return typeof candidate.tokenCan === "function" && typeof candidate.requireAbility === "function";
}

function isAuthUserDirectory(value: unknown): value is AuthAccountLookup {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as AuthAccountLookup).findByIdOrThrow === "function";
}

function resolveAbilityChecker(container: ServiceContainerLike): AbilityChecker {
  return container.resolve(CORE_ABILITY_CHECKER_TOKEN);
}

function resolveAuthUserDirectory(container: ServiceContainerLike): AuthAccountLookup | null {
  if (!container.has(CORE_AUTH_USER_DIRECTORY_TOKEN)) return null;
  const directory = container.resolve(CORE_AUTH_USER_DIRECTORY_TOKEN);
  if (!isAuthUserDirectory(directory))
    throw new TypeError("Invalid auth account lookup capability.");
  return directory;
}

export {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_EVENT_BUS_TOKEN,
  CORE_HTTP_CLEANUP_TOKEN,
  CORE_JSON_RESPONSE_POLICY_TOKEN,
  CORE_MAIL_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_PUBLIC_TENANCY_TOKEN,
  CORE_QUEUE_TOKEN,
  CORE_STORAGE_TOKEN,
  CORE_TENANT_RESOLVER_TOKEN,
  CORE_THROTTLE_QUOTA_POLICY_TOKEN,
  CORE_TRACING_RUNTIME_TOKEN,
  FAILED_JOB_SERVICE_TOKEN,
  isAbilityChecker,
  isAuthUserDirectory,
  resolveAbilityChecker,
  resolveAuthUserDirectory,
};
