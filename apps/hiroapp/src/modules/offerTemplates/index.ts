import type { AppModule } from "@getstrata/bootstrap/contracts";
import { offerTemplateRoutes } from "./routes.ts";
import { offerTemplateWebRoutes } from "./web.ts";

const offerTemplatesModule: AppModule = {
  name: "offerTemplates",
  order: 53,
  tableName: "offer_templates",
  routes({ dependencies }) {
    return offerTemplateRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return offerTemplateWebRoutes(dependencies);
  },
};

export default offerTemplatesModule;
