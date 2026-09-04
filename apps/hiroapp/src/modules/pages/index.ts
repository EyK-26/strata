import type { AppModule } from "@getstrata/bootstrap/contracts";
import { htmlRoutes } from "../dashboard/web.ts";

const pagesModule: AppModule = {
  name: "pages",
  order: 80,
  webRoutes({ dependencies }) {
    return htmlRoutes(dependencies);
  },
};

export default pagesModule;
