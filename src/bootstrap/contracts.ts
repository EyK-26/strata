import type {
  CharacterRepositoryLike,
  NemesisRepositoryLike,
  SecretRepositoryLike,
} from "../types/repositories";
import type {
  CacheLike,
  CharacterServiceLike,
  JSONTreeServiceLike,
  StatisticsServiceLike,
} from "../types/services";

type CachedJson = <T>(
  cacheKey: string,
  loader: () => Promise<T>,
) => Promise<Response>;
type AppRouteMap = Record<string, any>;
type ServiceFactory<T> = (container: ServiceContainer) => T;

class ServiceContainer {
  private readonly services = new Map<string, unknown>();
  private readonly singletonFactories = new Map<
    string,
    ServiceFactory<unknown>
  >();
  private readonly bindings = new Map<string, ServiceFactory<unknown>>();

  set<T>(key: string, value: T): T {
    this.singletonFactories.delete(key);
    this.bindings.delete(key);
    this.services.set(key, value);
    return value;
  }

  singleton<T>(key: string, factory: ServiceFactory<T>): void {
    this.bindings.delete(key);
    this.services.delete(key);
    this.singletonFactories.set(key, factory);
  }

  bind<T>(key: string, factory: ServiceFactory<T>): void {
    this.singletonFactories.delete(key);
    this.services.delete(key);
    this.bindings.set(key, factory);
  }

  get<T>(key: string): T {
    if (this.services.has(key)) {
      return this.services.get(key) as T;
    }

    const singletonFactory = this.singletonFactories.get(key);

    if (singletonFactory) {
      const value = singletonFactory(this);
      this.services.set(key, value);
      return value as T;
    }

    const binding = this.bindings.get(key);

    if (binding) {
      return binding(this) as T;
    }

    throw new Error(`Service "${key}" is not registered.`);
  }

  resolve<T>(key: string): T {
    return this.get<T>(key);
  }

  has(key: string): boolean {
    return (
      this.services.has(key) ||
      this.singletonFactories.has(key) ||
      this.bindings.has(key)
    );
  }
}

class ConfigStore {
  private readonly values = new Map<string, unknown>();

  set<T>(key: string, value: T): T {
    this.values.set(key, value);
    return value;
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    if (!this.values.has(key)) {
      throw new Error(`Config key "${key}" is not defined.`);
    }

    return this.values.get(key) as T;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

interface AppDependencies {
  container: ServiceContainer;
  cache: CacheLike;
  characterRepository: CharacterRepositoryLike;
  nemesisRepository: NemesisRepositoryLike;
  secretRepository: SecretRepositoryLike;
  characterService: CharacterServiceLike;
  statisticsService: StatisticsServiceLike;
  jsonTreeService: JSONTreeServiceLike;
}

type MutableAppDependencies = Partial<Omit<AppDependencies, "container">> &
  Pick<AppDependencies, "container">;

interface ProviderContext {
  container: ServiceContainer;
  config: ConfigStore;
  dependencies: MutableAppDependencies;
}

interface ModuleRouteContext {
  dependencies: AppDependencies;
  cachedJson: CachedJson;
}

interface ServiceProvider {
  name: string;
  register?(context: ProviderContext): void;
  boot?(context: ProviderContext): void;
}

interface AppModule {
  name: string;
  providers?: ServiceProvider[];
  routes?(context: ModuleRouteContext): AppRouteMap;
}

interface AppContext {
  container: ServiceContainer;
  config: ConfigStore;
  dependencies: AppDependencies;
}

const requiredDependencyKeys = [
  "container",
  "cache",
  "characterRepository",
  "nemesisRepository",
  "secretRepository",
  "characterService",
  "statisticsService",
  "jsonTreeService",
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

export type {
  AppContext,
  AppDependencies,
  AppModule,
  AppRouteMap,
  CachedJson,
  MutableAppDependencies,
  ModuleRouteContext,
  ProviderContext,
  ServiceFactory,
  ServiceProvider,
};
export {
  ConfigStore,
  ServiceContainer,
  assertAppDependenciesComplete,
  getRequiredDependency,
};
