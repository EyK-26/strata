import type { ServiceProvider } from "../contracts";
import { legacyCacheProvider } from "../legacyCache";
import authProvider from "./auth";
import configProvider from "./config";
import policyProvider from "./policy";
import queueProvider from "./queue";
import storageProvider from "./storage";
import tracingProvider from "./tracing";
import { viewProvider } from "./view";

const coreProviders: ServiceProvider[] = [
  configProvider,
  tracingProvider,
  legacyCacheProvider,
  storageProvider,
  authProvider,
  policyProvider,
  queueProvider,
  viewProvider,
];

export { coreProviders };
