import type { ServiceProvider } from "../contracts";
import authProvider from "./auth";
import cacheProvider from "./cache";
import configProvider from "./config";
import eventsProvider from "./events";
import listenersProvider from "./listeners";
import policyProvider from "./policy";
import queueProvider from "./queue";

const coreProviders: ServiceProvider[] = [
  configProvider,
  cacheProvider,
  authProvider,
  eventsProvider,
  policyProvider,
  queueProvider,
  listenersProvider,
];

export { coreProviders };
