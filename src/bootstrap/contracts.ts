export {
  ConfigStore,
  type ConfigStoreLike,
  ServiceContainer,
  type ServiceContainerLike,
} from "@getstrata/core/contracts/container";
export type {
  AppContext,
  AppDependencies,
  AppRouteMap,
  CachedJson,
  MutableAppDependencies,
  ProviderContext,
  ServiceFactory,
  ServiceProvider,
} from "@getstrata/core/contracts/di";
export {
  assertAppDependenciesComplete,
  getRequiredDependency,
  resolveService,
} from "@getstrata/core/contracts/di";

import type {
  AppDependencies,
  AppRouteMap,
  CachedJson,
  ServiceProvider,
} from "@getstrata/core/contracts/di";
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
