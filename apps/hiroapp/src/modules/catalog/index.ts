import type { AppModule } from "@getstrata/bootstrap/contracts";
import { catalogRoutes } from "./routes.ts";

const catalogModule: AppModule = {
  name: "catalog",
  order: 5,
  routes({ dependencies }) {
    return catalogRoutes(dependencies);
  },
};

export default catalogModule;
