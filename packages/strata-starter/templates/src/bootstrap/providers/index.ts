import type { ServiceProvider } from "@getstrata/core/contracts/di";
import authProvider from "./auth.ts";
import cacheProvider from "./cache.ts";
import configProvider from "./config.ts";
import storageProvider from "./storage.ts";

const starterProviders: ServiceProvider[] = [
  configProvider,
  cacheProvider,
  storageProvider,
  authProvider,
];

export { starterProviders };
