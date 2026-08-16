import type { CacheLike } from "../../types/services";
import type { ServiceContainerLike } from "./serviceContainer";

interface ConfigStoreLike {
  get<T>(key: string): T | undefined;
}

interface ApplicationDependenciesLike {
  container: ServiceContainerLike;
  cache: CacheLike;
  storage?: unknown;
}

interface ApplicationContext {
  container: ServiceContainerLike;
  config: ConfigStoreLike;
  dependencies: ApplicationDependenciesLike;
}

function getRequiredDependency<K extends keyof ApplicationDependenciesLike>(
  dependencies: Partial<ApplicationDependenciesLike>,
  key: K,
): ApplicationDependenciesLike[K] {
  const dependency = dependencies[key];

  if (dependency === undefined) {
    throw new Error(`Required dependency "${String(key)}" is not registered.`);
  }

  return dependency;
}

export type { ApplicationContext, ApplicationDependenciesLike, ConfigStoreLike };
export { getRequiredDependency };
