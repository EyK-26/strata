import { type AppContextOptions, createAppContext } from "./context";
import type { ServiceProvider } from "./contracts";

async function createAppDependencies(
  providers: readonly ServiceProvider[] | undefined,
  options: AppContextOptions,
) {
  return (await createAppContext(providers, options)).dependencies;
}

export type { AppContext, AppDependencies } from "./contracts";
export { createAppContext, createAppDependencies };
