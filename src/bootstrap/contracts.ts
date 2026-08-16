export {
  ConfigStore,
  type ConfigStoreLike,
  ServiceContainer,
  type ServiceContainerLike,
} from "../core/contracts/container.ts";
export type {
  AppContext,
  AppDependencies,
  AppRouteMap,
  CachedJson,
  MutableAppDependencies,
  ProviderContext,
  ServiceFactory,
  ServiceProvider,
} from "../core/contracts/di.ts";
export {
  assertAppDependenciesComplete,
  getRequiredDependency,
  resolveService,
} from "../core/contracts/di.ts";

import type {
  AppDependencies,
  AppRouteMap,
  CachedJson,
  ServiceProvider,
} from "../core/contracts/di.ts";
import type { HttpKernel } from "./httpKernel.ts";

interface ModuleRouteContext {
  dependencies: AppDependencies;
  cachedJson: CachedJson;
  kernel: HttpKernel;
}

interface AppModule {
  name: string;
  order?: number;
  tableName?: string;
  cacheTags?: readonly string[];
  cacheDeleteExtraTags?: readonly string[];
  providers?: ServiceProvider[];
  routes?(context: ModuleRouteContext): AppRouteMap;
  webRoutes?(context: ModuleRouteContext): AppRouteMap;
}

export type { AppModule, ModuleRouteContext };
