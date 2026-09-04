import type { AppModule } from "@getstrata/bootstrap/contracts";
import { referralRoutes } from "./routes.ts";
import { referralWebRoutes } from "./web.ts";

const referralsModule: AppModule = {
  name: "referrals",
  order: 49,
  tableName: "referrals",
  routes({ dependencies }) {
    return referralRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return referralWebRoutes(dependencies);
  },
};

export default referralsModule;
