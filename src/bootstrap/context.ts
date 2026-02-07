import {
  ConfigStore,
  ServiceContainer,
  assertAppDependenciesComplete,
  type AppContext,
  type AppModule,
  type MutableAppDependencies,
  type ProviderContext,
  type ServiceProvider,
} from "./contracts";
import { appModules } from "./modules";
import { coreProviders } from "./providers";

function collectProviders(modules: AppModule[] = appModules): ServiceProvider[] {
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

  return {
    container,
    config,
    dependencies,
  };
}

const appContext = createAppContext();

export { appContext, collectProviders, createAppContext, runProviderPhase };
