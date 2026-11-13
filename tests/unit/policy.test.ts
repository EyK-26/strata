import { describe, expect, test } from "bun:test";
import { Policy, PolicyGate } from "@getstrata/core/auth/policy";

class DefaultPolicy extends Policy {}

import { PolicyDeniedError } from "@getstrata/core/auth/policy";

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
  test("allows registered policy actions", async () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(await gate.allows("organization", "create", undefined)).toBe(true);
    expect(
      await gate.allows(
        "organization",
        "delete",
        undefined,
        new OrganizationRecord(1, "acme-labs"),
      ),
    ).toBe(true);
  });

  test("denies actions that the policy rejects", async () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(
      await gate.allows(
        "organization",
        "delete",
        undefined,
        new OrganizationRecord(2, "protected-org"),
      ),
    ).toBe(false);
  });

  test("authorize rejects with PolicyDeniedError when access is denied", async () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    await expect(
      gate.authorize(
        "organization",
        "delete",
        undefined,
        new OrganizationRecord(2, "protected-org"),
      ),
    ).rejects.toThrow(PolicyDeniedError);
  });

  test("denies unknown resources by default", async () => {
    const gate = new PolicyGate();

    expect(await gate.allows("project", "create", undefined)).toBe(false);
  });

  test("uses default Policy methods that deny access", async () => {
    const gate = new PolicyGate();
    gate.register("base", new DefaultPolicy());
    const basePolicy = new DefaultPolicy();

    expect(await gate.allows("base", "view", { id: 1 })).toBe(false);
    expect(await gate.allows("base", "create", { id: 1 })).toBe(false);
    expect(await gate.allows("base", "update", { id: 1 })).toBe(false);
    expect(await gate.allows("base", "delete", { id: 1 })).toBe(false);
    expect(basePolicy.create()).toBe(false);
    expect(basePolicy.view()).toBe(false);
    expect(basePolicy.update()).toBe(false);
    expect(basePolicy.delete()).toBe(false);
  });

  test("passes explicit users and models to policy handlers", async () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    expect(await gate.allows("organization", "create", { id: 9, role: "member" })).toBe(true);
    expect(
      await gate.allows(
        "organization",
        "delete",
        { id: 9, role: "member" },
        new OrganizationRecord(1, "acme-labs"),
      ),
    ).toBe(true);
  });

  test("returns false when a policy action is not callable", async () => {
    const gate = new PolicyGate();
    gate.register("broken", { view: "not-a-function" } as never);

    expect(await gate.allows("broken", "view", undefined)).toBe(false);
  });

  test("authorize succeeds when policy allows the action", async () => {
    const gate = new PolicyGate();
    gate.register("organization", new TestPolicy());

    await expect(gate.authorize("organization", "create", undefined)).resolves.toBeUndefined();
  });
});
