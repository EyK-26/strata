import type { CacheLike } from "../../types/services";
import type { StorageManager } from "../storage/storage";
import type { ConfigStore, ConfigStoreLike, ServiceContainer, ServiceFactory } from "./container";

// biome-ignore lint/suspicious/noExplicitAny: matches Bun's Routes map expectations
type AppRouteMap = Record<string, any>;

type CachedJson = <T>(
  cacheKey: string,
  loader: () => Promise<T>,
  tags?: string[],
  request?: Request,
) => Promise<Response>;

interface AppDependencies {
  container: ServiceContainer;
  cache: CacheLike;
  storage: StorageManager;
}

type MutableAppDependencies = Partial<Omit<AppDependencies, "container">> &
  Pick<AppDependencies, "container">;

interface ProviderContext {
  container: ServiceContainer;
  config: ConfigStore;
  dependencies: MutableAppDependencies;
}

interface ServiceProvider {
  name: string;
  register?(context: ProviderContext): void;
  boot?(context: ProviderContext): void;
}

interface AppContext {
  container: ServiceContainer;
  config: ConfigStoreLike;
  dependencies: AppDependencies;
}

const requiredDependencyKeys = [
  "container",
  "cache",
  "storage",
] as const satisfies readonly (keyof AppDependencies)[];

function getRequiredDependency<K extends keyof AppDependencies>(
  dependencies: Partial<AppDependencies>,
  key: K,
): AppDependencies[K] {
  const dependency = dependencies[key];

  if (dependency === undefined) {
    throw new Error(`Required dependency "${key}" is not registered.`);
  }

  return dependency;
}

function assertAppDependenciesComplete(
  dependencies: MutableAppDependencies,
): asserts dependencies is AppDependencies {
  for (const key of requiredDependencyKeys) {
    getRequiredDependency(dependencies, key);
  }
}

function resolveService<T>(dependencies: AppDependencies, token: string): T {
  return dependencies.container.resolve<T>(token);
}

export type {
  AppContext,
  AppDependencies,
  AppRouteMap,
  CachedJson,
  MutableAppDependencies,
  ProviderContext,
  ServiceFactory,
  ServiceProvider,
};
export { assertAppDependenciesComplete, getRequiredDependency, resolveService };
