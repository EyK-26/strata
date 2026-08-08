import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "../../src/core/errors/http";
import { Policy, PolicyGate } from "../../src/core/auth/policy";

class OrganizationRecord {
  constructor(
    readonly id: number,
    readonly slug: string,
  ) {}
}

class OrganizationPolicy extends Policy {
  override create(): boolean {
    return true;
  }

  override delete(
    _user: unknown,
    organization: OrganizationRecord,
  ): boolean {
    return organization.slug !== "protected-org";
  }
}

describe("PolicyGate", () => {
  test("allows registered policy actions", () => {
    const gate = new PolicyGate();
    gate.register("organization", new OrganizationPolicy());

    expect(gate.allows("organization", "create")).toBe(true);
    expect(
      gate.allows(
        "organization",
        "delete",
        undefined,
        new OrganizationRecord(1, "acme-labs"),
      ),
    ).toBe(true);
  });

  test("denies actions that the policy rejects", () => {
    const gate = new PolicyGate();
    gate.register("organization", new OrganizationPolicy());

    expect(
      gate.allows(
        "organization",
        "delete",
        undefined,
        new OrganizationRecord(2, "protected-org"),
      ),
    ).toBe(false);
  });

  test("authorize throws ForbiddenError when access is denied", () => {
    const gate = new PolicyGate();
    gate.register("organization", new OrganizationPolicy());

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
});
