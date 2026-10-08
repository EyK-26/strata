import { createAppContext } from "./context";

async function createAppDependencies() {
  return (await createAppContext()).dependencies;
}

export type { AppContext, AppDependencies } from "./contracts";
export { createAppContext, createAppDependencies };
