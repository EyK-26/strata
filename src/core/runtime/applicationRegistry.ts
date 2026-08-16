import type { CacheLike } from "../../types/services";
import type { AuthManager } from "../auth/guard";
import type { PolicyGate } from "../auth/policy";
import type { ApplicationContext } from "../contracts/applicationContext";
import { getRequiredDependency } from "../contracts/applicationContext";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "../contracts/serviceTokens";
import { appLogger, type Logger } from "../logging/logger";
import type { Queue } from "../queue";

const APPLICATION_CONTEXT_KEY = Symbol.for("@getstrata/applicationContext");

let activeContext: ApplicationContext | undefined;

function readStoredApplicationContext(): ApplicationContext | undefined {
  if (activeContext) {
    return activeContext;
  }

  const globalContext = (globalThis as Record<symbol, ApplicationContext | undefined>)[
    APPLICATION_CONTEXT_KEY
  ];

  if (globalContext) {
    activeContext = globalContext;
  }

  return activeContext;
}

function setActiveApplicationContext(context: ApplicationContext): void {
  activeContext = context;
  (globalThis as Record<symbol, ApplicationContext>)[APPLICATION_CONTEXT_KEY] = context;
}

function requireActiveApplicationContext(): ApplicationContext {
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
  resolveApplicationLogger,
  resolveApplicationPolicyGate,
  resolveApplicationQueue,
  setActiveApplicationContext,
};
