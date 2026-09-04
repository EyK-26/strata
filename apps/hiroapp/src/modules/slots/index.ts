import type { AppModule } from "@getstrata/bootstrap/contracts";
import { slotRoutes } from "./routes.ts";
import { slotWebRoutes } from "./web.ts";

const slotsModule: AppModule = {
  name: "slots",
  order: 51,
  tableName: "interview_slots",
  routes({ dependencies }) {
    return slotRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return slotWebRoutes(dependencies);
  },
};

export default slotsModule;
