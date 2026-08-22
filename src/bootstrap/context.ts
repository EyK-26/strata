import { setActiveApplicationContext } from "./applicationRegistry.ts";
import {
  type AppContext,
  type AppModule,
  assertAppDependenciesComplete,
  ConfigStore,
  type MutableAppDependencies,
  type ProviderContext,
  ServiceContainer,
  type ServiceProvider,
} from "./contracts";
import { discoverModules } from "./modules";
import { coreProviders } from "./providers";

function collectProviders(modules: AppModule[] = discoverModules()): ServiceProvider[] {
  return [...coreProviders, ...modules.flatMap((module) => module.providers ?? [])];
}

function runProviderPhase(
  providers: ServiceProvider[],
  phase: "register" | "boot",
  context: ProviderContext,
): void {
  for (const provider of providers) {
    provider[phase]?.(context);
  }
}

function createAppContext(): AppContext {
  const container = new ServiceContainer();
  const config = new ConfigStore();
  const dependencies: MutableAppDependencies = {
    container,
  };
  const context: ProviderContext = {
    container,
    config,
    dependencies,
  };
  const providers = collectProviders();

  runProviderPhase(providers, "register", context);
  runProviderPhase(providers, "boot", context);

  assertAppDependenciesComplete(dependencies);

  const appContext = {
    container,
    config,
    dependencies,
  };

  setActiveApplicationContext(appContext);

  return appContext;
}

let cachedAppContext: AppContext | undefined;

function getAppContext(): AppContext {
  cachedAppContext ??= createAppContext();
  return cachedAppContext;
}

const appContext: AppContext = {
  get container() {
    return getAppContext().container;
  },
  get config() {
    return getAppContext().config;
  },
  get dependencies() {
    return getAppContext().dependencies;
  },
};

export { appContext, collectProviders, createAppContext, runProviderPhase };
