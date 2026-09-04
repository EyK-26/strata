import type { AppModule } from "@getstrata/bootstrap/contracts";
import { positionRoutes } from "./routes.ts";

const positionsModule: AppModule = {
  name: "positions",
  order: 30,
  tableName: "positions",
  routes({ dependencies }) {
    return positionRoutes(dependencies);
  },
};

export default positionsModule;
