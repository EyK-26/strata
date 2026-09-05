import type { AppModule } from "@getstrata/bootstrap/contracts";
import { kioskRoutes } from "./routes.ts";
import { kioskWebRoutes } from "./web.ts";

const kioskModule: AppModule = {
  name: "kiosk",
  order: 47,
  routes({ dependencies }) {
    return kioskRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return kioskWebRoutes(dependencies);
  },
};

export default kioskModule;
