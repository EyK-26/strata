import { describe, expect, test } from "bun:test";
import { Policy, PolicyGate } from "../../src/core/auth/policy";

class DefaultPolicy extends Policy {}

import { ForbiddenError } from "../../src/core/errors/http";

class OrganizationRecord {
  constructor(
    readonly id: number,
    readonly slug: string,
  ) {}
}

class TestPolicy extends Policy {
  override view(): boolean {
    return true;
  }

  override create(): boolean {
    return true;
  }

  override update(): boolean {
    return true;
  }

  override delete(_user: unknown, organization: OrganizationRecord): boolean {
    return organization.slug !== "protected-org";
  }
}

describe("PolicyGate", () => {
  test("allows registered policy actions", () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(gate.allows("organization", "create")).toBe(true);
    expect(
      gate.allows("organization", "delete", undefined, new OrganizationRecord(1, "acme-labs")),
    ).toBe(true);
  });

  test("denies actions that the policy rejects", () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(
      gate.allows("organization", "delete", undefined, new OrganizationRecord(2, "protected-org")),
    ).toBe(false);
  });

  test("authorize throws ForbiddenError when access is denied", () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(() =>
      gate.authorize(
        "organization",
        "delete",
        undefined,
        new OrganizationRecord(2, "protected-org"),
      ),
    ).toThrow(ForbiddenError);
  });

  test("denies unknown resources by default", () => {
    const gate = new PolicyGate();

    expect(gate.allows("project", "create")).toBe(false);
  });

  test("uses default Policy methods that deny access", () => {
    const gate = new PolicyGate();
    gate.register("base", new DefaultPolicy());
    const basePolicy = new DefaultPolicy();

    expect(gate.allows("base", "view", { id: 1 })).toBe(false);
    expect(gate.allows("base", "create", { id: 1 })).toBe(false);
    expect(gate.allows("base", "update", { id: 1 })).toBe(false);
    expect(gate.allows("base", "delete", { id: 1 })).toBe(false);
    expect(basePolicy.create()).toBe(false);
    expect(basePolicy.view()).toBe(false);
    expect(basePolicy.update()).toBe(false);
    expect(basePolicy.delete()).toBe(false);
  });

  test("passes explicit users and models to policy handlers", () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(gate.allows("organization", "create", { id: 9, role: "member" })).toBe(true);
    expect(
      gate.allows(
        "organization",
        "delete",
        { id: 9, role: "member" },
        new OrganizationRecord(1, "acme-labs"),
      ),
    ).toBe(true);
  });

  test("returns false when a policy action is not callable", () => {
    const gate = new PolicyGate();
    gate.register("broken", { view: "not-a-function" } as never);

    expect(gate.allows("broken", "view")).toBe(false);
  });

  test("authorize succeeds when policy allows the action", () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(() => gate.authorize("organization", "create")).not.toThrow();
  });
});
