import {
  getRequiredDependency,
  type ServiceProvider,
} from "../../bootstrap/contracts";
import StatisticsService from "./service";

const statisticsServiceToken = "statistics.service";

const statisticsProvider: ServiceProvider = {
  name: "statistics.provider",
  boot({ container, dependencies }) {
    container.singleton(
      statisticsServiceToken,
      () =>
        new StatisticsService(
          getRequiredDependency(dependencies, "characterRepository"),
          getRequiredDependency(dependencies, "nemesisRepository"),
        ),
    );

    dependencies.statisticsService = container.resolve(statisticsServiceToken);
  },
};

export default statisticsProvider;
export { statisticsServiceToken };
