import type { AppModule } from "@getstrata/bootstrap/contracts";
import ReportController from "./controller";
import reportProvider, { reportServiceToken } from "./provider";
import { createReportRoutes } from "./routes";
import { createReportWebRoutes } from "./webController";

const reportModule: AppModule = {
  name: "report",
  order: 50,
  providers: [reportProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createReportRoutes(dependencies, cachedJson, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return createReportWebRoutes(dependencies, kernel);
  },
};

export default reportModule;
export { parseOrganizationReportParams } from "./requests";
export {
  toOrganizationReportResource,
  toReportSummaryResource,
} from "./resources";
export { createReportRoutes } from "./routes";
export { default as ReportService } from "./service";
export type { OrganizationReport, ReportSummary } from "./types";
export { ReportController, reportProvider, reportServiceToken };
