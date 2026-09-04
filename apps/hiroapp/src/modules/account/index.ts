import type { AppModule } from "@getstrata/bootstrap/contracts";
import { accountRoutes } from "./routes.ts";
import { accountWebRoutes } from "./web.ts";

const accountModule: AppModule = {
  name: "account",
  order: 15,
  routes({ dependencies }) {
    return accountRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return accountWebRoutes(dependencies);
  },
};

export default accountModule;
