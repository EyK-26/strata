import type { AppModule } from "@getstrata/bootstrap/contracts";
import { scimRoutes } from "./routes.ts";

const scimModule: AppModule = {
  name: "scim",
  order: 70,
  routes({ dependencies }) {
    return scimRoutes(dependencies);
  },
};

export default scimModule;
