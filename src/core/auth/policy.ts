import { ForbiddenError } from "../errors/http";
import { currentAuthUser } from "./authContext";

abstract class Policy {
  constructor() {}

  view(_user?: unknown, _resource?: unknown): boolean {
    return false;
  }

  create(_user?: unknown): boolean {
    return false;
  }

  update(_user?: unknown, _resource?: unknown): boolean {
    return false;
  }

  delete(_user?: unknown, _resource?: unknown): boolean {
    return false;
  }
}

const BLOCKED_POLICY_ACTIONS = new Set([
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__proto__",
]);

class PolicyGate {
  constructor() {}

  private readonly policies = new Map<string, Policy>();

  register(resource: string, policy: Policy): void {
    this.policies.set(resource, policy);
  }

  allows(resource: string, action: string, user?: unknown, model?: unknown): boolean {
    const policy = this.policies.get(resource);

    if (!policy) {
      return false;
    }

    if (BLOCKED_POLICY_ACTIONS.has(action) || !(action in policy)) {
      return false;
    }

    const handler = (policy as unknown as Record<string, unknown>)[action];

    if (typeof handler !== "function") {
      return false;
    }

    const resolvedUser = user === undefined ? currentAuthUser() : user;

    return model === undefined
      ? (handler as (user?: unknown) => boolean).call(policy, resolvedUser)
      : (handler as (user: unknown, model: unknown) => boolean).call(policy, resolvedUser, model);
  }

  authorize(resource: string, action: string, user?: unknown, model?: unknown): void {
    if (!this.allows(resource, action, user, model)) {
      throw new ForbiddenError();
    }
  }
}

export { Policy, PolicyGate };
