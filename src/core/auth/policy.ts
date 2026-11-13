/** Every policy decision is awaited, including synchronous policies. */
type PolicyDecision = boolean | Promise<boolean>;

abstract class Policy {
  view(_user?: unknown, _resource?: unknown): PolicyDecision {
    return false;
  }

  create(_user?: unknown): PolicyDecision {
    return false;
  }

  update(_user?: unknown, _resource?: unknown): PolicyDecision {
    return false;
  }

  delete(_user?: unknown, _resource?: unknown): PolicyDecision {
    return false;
  }
}

/** Domain denial; transport adapters decide how to present it. */
class PolicyDeniedError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "PolicyDeniedError";
  }
}

type PolicyAction<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => PolicyDecision ? K : never;
}[keyof T] &
  string;
type PolicyArguments<T> = T extends (...args: infer Args) => PolicyDecision ? Args : never;

const BLOCKED_POLICY_ACTIONS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "__proto__",
]);

/** Supply a policy map type (or constructor map) for typed custom actions and arguments. */
class PolicyGate<Policies extends { [K in keyof Policies]: Policy } = Record<string, Policy>> {
  private readonly policies = new Map<string, Policy>();

  constructor(policies?: Policies) {
    if (policies) {
      for (const [resource, policy] of Object.entries<Policy>(policies)) {
        this.policies.set(resource, policy);
      }
    }
  }

  register<Resource extends keyof Policies & string>(
    resource: Resource,
    policy: Policies[Resource],
  ): void {
    this.policies.set(resource, policy);
  }

  async allows<
    Resource extends keyof Policies & string,
    Action extends PolicyAction<Policies[Resource]>,
  >(
    resource: Resource,
    action: Action,
    user: PolicyArguments<Policies[Resource][Action]>[0],
    ...model: PolicyArguments<Policies[Resource][Action]> extends [unknown?, ...infer Rest]
      ? Rest
      : never
  ): Promise<boolean> {
    const policy = this.policies.get(resource);
    if (
      !policy ||
      typeof action !== "string" ||
      BLOCKED_POLICY_ACTIONS.has(action) ||
      !(action in policy)
    ) {
      return false;
    }

    const handler = (policy as unknown as Record<string, unknown>)[action];
    if (typeof handler !== "function") {
      return false;
    }

    // Preserve the policy receiver (including private fields). Rejections propagate
    // to the caller as operational errors; only an exact true grants access.
    return (await handler.call(policy, user, ...model)) === true;
  }

  async authorize<
    Resource extends keyof Policies & string,
    Action extends PolicyAction<Policies[Resource]>,
  >(
    resource: Resource,
    action: Action,
    user: PolicyArguments<Policies[Resource][Action]>[0],
    ...model: PolicyArguments<Policies[Resource][Action]> extends [unknown?, ...infer Rest]
      ? Rest
      : never
  ): Promise<void> {
    if (!(await this.allows(resource, action, user, ...model))) {
      throw new PolicyDeniedError();
    }
  }
}

export type { PolicyAction, PolicyDecision };
export { Policy, PolicyDeniedError, PolicyGate };
