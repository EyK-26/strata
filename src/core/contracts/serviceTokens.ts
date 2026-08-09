import type { AbilityChecker } from "../auth/abilityChecker";
import type { AuthUserDirectory } from "./authUserDirectory";
import type { ServiceContainerLike } from "./container";

const CORE_CONFIG_TOKEN = "core.config";
const CORE_CACHE_TOKEN = "core.cache";
const CORE_QUEUE_TOKEN = "core.queue";
const CORE_EVENT_BUS_TOKEN = "core.eventBus";
const CORE_POLICY_GATE_TOKEN = "core.policyGate";
const CORE_AUTH_TOKEN = "core.auth";
const CORE_TOKEN_SERVICE_TOKEN = "core.tokenService";
const CORE_ABILITY_CHECKER_TOKEN = "core.abilityChecker";
const CORE_AUTH_USER_DIRECTORY_TOKEN = "core.authUserDirectory";

function isAbilityChecker(value: unknown): value is AbilityChecker {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as AbilityChecker;

  return typeof candidate.tokenCan === "function" && typeof candidate.requireAbility === "function";
}

function isAuthUserDirectory(value: unknown): value is AuthUserDirectory {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as AuthUserDirectory).findByIdOrThrow === "function";
}

function resolveAbilityChecker(container: ServiceContainerLike): AbilityChecker {
  if (container.has(CORE_ABILITY_CHECKER_TOKEN)) {
    return container.resolve<AbilityChecker>(CORE_ABILITY_CHECKER_TOKEN);
  }

  return container.resolve<AbilityChecker>(CORE_TOKEN_SERVICE_TOKEN);
}

function resolveAuthUserDirectory(container: ServiceContainerLike): AuthUserDirectory | null {
  if (container.has(CORE_AUTH_USER_DIRECTORY_TOKEN)) {
    const directory = container.resolve<unknown>(CORE_AUTH_USER_DIRECTORY_TOKEN);

    if (isAuthUserDirectory(directory)) {
      return directory;
    }
  }

  if (container.has(CORE_TOKEN_SERVICE_TOKEN)) {
    const tokenService = container.resolve<unknown>(CORE_TOKEN_SERVICE_TOKEN);

    if (isAuthUserDirectory(tokenService)) {
      return tokenService;
    }
  }

  return null;
}

export {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
  CORE_CACHE_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_EVENT_BUS_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
  CORE_TOKEN_SERVICE_TOKEN,
  isAbilityChecker,
  isAuthUserDirectory,
  resolveAbilityChecker,
  resolveAuthUserDirectory,
};
