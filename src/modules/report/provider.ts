import type { ServiceProvider } from "../../bootstrap/contracts";
import ReportService from "./service";

const reportServiceToken = "report.service";

const reportProvider: ServiceProvider = {
  name: "report.provider",
  boot({ container }) {
    container.singleton(
      reportServiceToken,
      () =>
        new ReportService(
          container.resolve("organization.repository"),
          container.resolve("project.repository"),
          container.resolve("task.repository"),
          container.resolve("comment.repository"),
        ),
    );
  },
};

export default reportProvider;
export { reportServiceToken };
