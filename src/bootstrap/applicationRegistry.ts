import type { AuthManager } from "../core/auth/guard";
import type { PolicyGate } from "../core/auth/policy";
import { appLogger, type Logger } from "../core/logging/logger";
import type { Queue } from "../core/queue";
import type { CacheLike } from "../types/services";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN, CORE_QUEUE_TOKEN } from "./config";
import type { AppContext } from "./contracts";
import { type ConfigStore, getRequiredDependency } from "./contracts";

let activeContext: AppContext | undefined;

function setActiveApplicationContext(context: AppContext): void {
  activeContext = context;
}

function requireActiveApplicationContext(): AppContext {
  if (!activeContext) {
    throw new Error("The application context has not been bootstrapped.");
  }

  return activeContext;
}

function resolveApplicationCache(): CacheLike {
  return getRequiredDependency(requireActiveApplicationContext().dependencies, "cache");
}

function resolveApplicationQueue(): Queue {
  return requireActiveApplicationContext().container.resolve<Queue>(CORE_QUEUE_TOKEN);
}

function resolveApplicationAuth(): AuthManager {
  return requireActiveApplicationContext().container.resolve<AuthManager>(CORE_AUTH_TOKEN);
}

function resolveApplicationPolicyGate(): PolicyGate {
  return requireActiveApplicationContext().container.resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);
}

function resolveApplicationConfig(): ConfigStore {
  return requireActiveApplicationContext().config;
}

function resolveApplicationLogger(): Logger {
  return appLogger;
}

function resolveApplicationDependencies() {
  return requireActiveApplicationContext().dependencies;
}

export {
  resolveApplicationAuth,
  resolveApplicationCache,
  resolveApplicationConfig,
  resolveApplicationDependencies,
  resolveApplicationLogger,
  resolveApplicationPolicyGate,
  resolveApplicationQueue,
  setActiveApplicationContext,
};
