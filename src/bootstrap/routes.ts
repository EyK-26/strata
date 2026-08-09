import { appContext } from "./context";
import { createRoutes } from "./createRoutes";

const routes = createRoutes(appContext.dependencies);

export { routes };
