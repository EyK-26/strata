import { type AppModule } from "../../bootstrap/contracts";
import TreeController from "./controller";
import { createTreeRoutes } from "./routes";
import treeProvider, { jsonTreeServiceToken } from "./provider";

const treeModule: AppModule = {
  name: "tree",
  providers: [treeProvider],
  routes({ dependencies, cachedJson }) {
    return createTreeRoutes(dependencies, cachedJson);
  },
};

export default treeModule;
export { TreeController };
export { treeProvider, jsonTreeServiceToken };
export { toJSONTreeResource } from "./resources";
export type { JSONTreeResource } from "./resources";
export { createTreeRoutes } from "./routes";
export { default as JSONTreeService } from "./service";
