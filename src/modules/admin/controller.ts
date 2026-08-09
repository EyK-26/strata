import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http";
import { adminServiceToken } from "./provider";
import type AdminService from "./service";

class AdminController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): AdminService {
    return resolveService(this.dependencies, adminServiceToken);
  }

  readonly stats = withErrorHandling(async () => {
    return jsonResponse(await this.service.stats());
  });

  readonly tenants = withErrorHandling(async () => {
    return jsonResponse({ data: await this.service.listTenants() });
  });

  readonly organizationMembers = withErrorHandling(async () => {
    return jsonResponse({ data: await this.service.listOrganizationMembers() });
  });

  readonly features = withErrorHandling(async () => {
    return jsonResponse(this.service.featureFlags());
  });
}

export default AdminController;
