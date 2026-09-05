import type { AppModule } from "@getstrata/bootstrap/contracts";
import { ssoWebRoutes } from "./web.ts";

const ssoModule: AppModule = {
  name: "sso",
  order: 11,
  webRoutes({ dependencies }) {
    return ssoWebRoutes(dependencies);
  },
};

export default ssoModule;
