import type { ServiceProvider } from "../contracts";
import cacheProvider from "./cache";
import configProvider from "./config";

const coreProviders: ServiceProvider[] = [configProvider, cacheProvider];

export { coreProviders };
