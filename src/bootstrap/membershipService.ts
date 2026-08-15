import MembershipService from "../core/auth/membershipService";
import { resolveApplicationDependencies } from "./applicationRegistry";

function resolveMembershipService(): MembershipService {
  const dependencies = resolveApplicationDependencies();

  if (dependencies.container.has("core.membership")) {
    return dependencies.container.resolve<MembershipService>("core.membership");
  }

  return new MembershipService();
}

export { resolveMembershipService };
