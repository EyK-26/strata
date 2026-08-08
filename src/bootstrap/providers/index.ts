import type { ServiceProvider } from "../contracts";
import cacheProvider from "./cache";
import authProvider from "./auth";
import configProvider from "./config";
import eventsProvider from "./events";
import policyProvider from "./policy";
import queueProvider from "./queue";
import listenersProvider from "./listeners";

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
