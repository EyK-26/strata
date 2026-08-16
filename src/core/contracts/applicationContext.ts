import type { AppContext, AppDependencies } from "./di";

/** @deprecated Use AppContext from @getstrata/core/contracts/di */
type ApplicationContext = AppContext;

/** @deprecated Use AppDependencies from @getstrata/core/contracts/di */
type ApplicationDependenciesLike = AppDependencies;

export { getRequiredDependency } from "./di";
export type { ApplicationContext, ApplicationDependenciesLike };
