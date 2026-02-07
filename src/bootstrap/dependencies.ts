import { createAppContext } from "./context";

function createAppDependencies() {
  return createAppContext().dependencies;
}

export type { AppContext, AppDependencies } from "./contracts";
export { createAppContext, createAppDependencies };
