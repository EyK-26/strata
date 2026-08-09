import type { AuthManager } from "@getstrata/core/auth/guard";
import type { PolicyGate } from "@getstrata/core/auth/policy";
import type { EventBus } from "@getstrata/core/events";
import type { CacheLike } from "../../types/services";
import type { AppContext } from "../contracts/di";
import { getRequiredDependency } from "../contracts/di";
import {
  CORE_AUTH_TOKEN,
  CORE_EVENT_BUS_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "../contracts/serviceTokens";
import { appLogger, type Logger } from "../logging/logger";
import type { Queue } from "../queue";

const APPLICATION_CONTEXT_KEY = Symbol.for("@getstrata/applicationContext");

let activeContext: AppContext | undefined;

function readStoredApplicationContext(): AppContext | undefined {
  const globalContext = (globalThis as Record<symbol, AppContext | undefined>)[
    APPLICATION_CONTEXT_KEY
  ];

  if (globalContext) {
    activeContext = globalContext;
    return activeContext;
  }

  return activeContext;
}

function setActiveApplicationContext(context: AppContext): void {
  activeContext = context;
  (globalThis as Record<symbol, AppContext>)[APPLICATION_CONTEXT_KEY] = context;
}

function requireActiveApplicationContext(): AppContext {
  const context = readStoredApplicationContext();

  if (!context) {
    throw new Error("The application context has not been bootstrapped.");
  }

  return context;
}

function resolveApplicationCache(): CacheLike {
  return getRequiredDependency(requireActiveApplicationContext().dependencies, "cache");
}

function resolveApplicationQueue(): Queue {
  return requireActiveApplicationContext().container.resolve<Queue>(CORE_QUEUE_TOKEN);
}

function resolveApplicationEventBus(): EventBus {
  return requireActiveApplicationContext().container.resolve<EventBus>(CORE_EVENT_BUS_TOKEN);
}

function resolveApplicationAuth(): AuthManager {
  return requireActiveApplicationContext().container.resolve<AuthManager>(CORE_AUTH_TOKEN);
}

function resolveApplicationPolicyGate(): PolicyGate {
  return requireActiveApplicationContext().container.resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);
}

function resolveApplicationConfig() {
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
  resolveApplicationEventBus,
  resolveApplicationLogger,
  resolveApplicationPolicyGate,
  resolveApplicationQueue,
  setActiveApplicationContext,
};
