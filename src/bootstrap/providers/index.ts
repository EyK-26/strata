import type { ServiceProvider } from "../contracts";
import authProvider from "./auth";
import cacheProvider from "./cache";
import configProvider from "./config";
import eventsProvider from "./events";
import listenersProvider from "./listeners";
import policyProvider from "./policy";
import queueProvider from "./queue";
import storageProvider from "./storage";
import tracingProvider from "./tracing";
import { viewProvider } from "./view";

const coreProviders: ServiceProvider[] = [
  configProvider,
  tracingProvider,
  cacheProvider,
  storageProvider,
  authProvider,
  eventsProvider,
  policyProvider,
  queueProvider,
  listenersProvider,
  viewProvider,
];

export { coreProviders };
