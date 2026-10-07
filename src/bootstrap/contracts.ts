export {
  ConfigStore,
  type ConfigStoreLike,
  createServiceToken,
  ServiceContainer,
  type ServiceContainerLike,
  type ServiceToken,
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

import type { OpenApiRouteMap } from "@getstrata/core/openapi/registeredRoute";

interface AppModule {
  /** Paths match this module's API route map before apiPrefix is applied. */
  openApi?: OpenApiRouteMap;
  name: string;
  order?: number;
  tableName?: string;
  cacheTags?: readonly string[];
  cacheDeleteExtraTags?: readonly string[];
  providers?: ServiceProvider[];
  routes?(context: ModuleRouteContext): AppRouteMap;
  webRoutes?(context: ModuleRouteContext): AppRouteMap;
}

export type {
  OpenApiOperation,
  OpenApiRouteMap,
  OpenApiSchema,
} from "@getstrata/core/openapi/registeredRoute";
export type { AppModule, ModuleRouteContext };
