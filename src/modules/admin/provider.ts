import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import AdminService from "./service";

const adminServiceToken = "admin.service";

const adminProvider: ServiceProvider = {
  name: "admin.provider",
  register({ container }) {
    container.singleton(adminServiceToken, () => {
      const failedJobs = container.has(FAILED_JOB_SERVICE_TOKEN)
        ? container.resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN)
        : undefined;

      return failedJobs ? new AdminService(failedJobs) : new AdminService();
    });
  },
};

export default adminProvider;
export { adminServiceToken };
