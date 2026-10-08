import { clearActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
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
import { discoverModules, ensureModulesLoaded } from "./modules";
import { coreProviders } from "./providers";

type InitializedAppContext = AppContext & { dispose(): Promise<void> };

function collectProviders(modules: AppModule[] = discoverModules()): ServiceProvider[] {
  return [...coreProviders, ...modules.flatMap((module) => module.providers ?? [])];
}

async function runProviderPhase(
  providers: readonly ServiceProvider[],
  phase: "register" | "boot",
  context: ProviderContext,
): Promise<void> {
  for (const provider of providers) await provider[phase]?.(context);
}

let readyContext: InitializedAppContext | undefined;

async function createAppContext(
  providers?: readonly ServiceProvider[],
): Promise<InitializedAppContext> {
  if (!providers) await ensureModulesLoaded();
  const configured = [...(providers ?? collectProviders())];
  const container = new ServiceContainer();
  const config = new ConfigStore();
  const dependencies: MutableAppDependencies = { container };
  const cleanups: Array<() => void | Promise<void>> = [];
  let disposal: Promise<void> | undefined;
  let disposed = false;
  let initialized: InitializedAppContext | undefined;
  const dispose = (): Promise<void> => {
    disposed = true;
    if (initialized) {
      clearActiveApplicationContext(initialized);
      if (readyContext === initialized) readyContext = undefined;
    }
    disposal ??= (async () => {
      const errors: unknown[] = [];
      for (const handler of cleanups.splice(0).reverse()) {
        try {
          await handler();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Provider cleanup failed.");
    })();
    return disposal;
  };
  const context: ProviderContext = {
    container,
    config,
    dependencies,
    onCleanup(handler) {
      if (disposed) throw new Error("Cannot register cleanup on a disposed application context.");
      cleanups.push(handler);
    },
  };
  try {
    await runProviderPhase(configured, "register", context);
    await runProviderPhase(configured, "boot", context);
    assertAppDependenciesComplete(dependencies);
    const appContext: InitializedAppContext = { container, config, dependencies, dispose };
    initialized = appContext;
    setActiveApplicationContext(appContext);
    readyContext = appContext;
    return appContext;
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Application startup and cleanup failed.", {
        cause: error,
      });
    }
    throw error;
  }
}

function getAppContext(): InitializedAppContext {
  if (!readyContext)
    throw new Error(
      "Application context is not ready. Await createAppContext() before using appContext.",
    );
  return readyContext;
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

export type { InitializedAppContext };
export { appContext, collectProviders, createAppContext, runProviderPhase };
