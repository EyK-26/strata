import { createMembershipContextMiddleware } from "./membershipContextMiddleware";

function createMembershipMiddleware() {
  return createMembershipContextMiddleware();
}

export { createMembershipMiddleware };
