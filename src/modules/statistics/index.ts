import { type AppModule } from "../../bootstrap/contracts";
import StatisticsController from "./controller";
import statisticsProvider, { statisticsServiceToken } from "./provider";
import { createStatisticsRoutes } from "./routes";

const statisticsModule: AppModule = {
  name: "statistics",
  providers: [statisticsProvider],
  routes({ dependencies, cachedJson }) {
    return createStatisticsRoutes(dependencies, cachedJson);
  },
};

export default statisticsModule;
export { StatisticsController };
export { statisticsProvider, statisticsServiceToken };
export { toStatisticsResource } from "./resources";
export { createStatisticsRoutes } from "./routes";
export { default as StatisticsService } from "./service";
