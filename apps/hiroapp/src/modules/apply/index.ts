import type { AppModule } from "@getstrata/bootstrap/contracts";
import { applyRoutes } from "./routes.ts";

const applyModule: AppModule = {
  name: "apply",
  order: 41,
  routes({ dependencies }) {
    return applyRoutes(dependencies);
  },
};

export default applyModule;
