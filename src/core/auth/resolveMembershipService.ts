import { resolveApplicationDependencies } from "@getstrata/core/runtime/applicationRegistry";
import MembershipService from "./membershipService";

function resolveMembershipService(): MembershipService {
  const dependencies = resolveApplicationDependencies();

  if (dependencies.container.has("core.membership")) {
    return dependencies.container.resolve<MembershipService>("core.membership");
  }

  return new MembershipService();
}

export { resolveMembershipService };
