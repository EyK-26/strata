import { afterEach, describe, expect, test } from "bun:test";
import { membershipContext } from "../../src/core/auth/membershipContext";
import { PolicyGate } from "../../src/core/auth/policy";
import ProjectPolicy from "../../src/modules/project/policy";
import type { ProjectRecord } from "../../src/modules/project/types";

const project: ProjectRecord = {
  id: 1,
  organization_id: 5,
  tenant_id: 1,
  name: "Platform",
  status: "active",
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

function createGate(): PolicyGate {
  const gate = new PolicyGate();
  gate.register("project", new ProjectPolicy());
  return gate;
}

function withMembership<T>(
  organizationIds: number[],
  roles: Array<[number, "member" | "admin" | "owner"]>,
  callback: () => T,
): T {
  return membershipContext.run(
    {
      organizationIds,
      rolesByOrganizationId: new Map(roles),
    },
    callback,
  );
}

describe("ProjectPolicy", () => {
  const originalPublicReads = process.env.FEATURE_PUBLIC_READS;

  afterEach(() => {
    if (originalPublicReads === undefined) {
      delete process.env.FEATURE_PUBLIC_READS;
    } else {
      process.env.FEATURE_PUBLIC_READS = originalPublicReads;
    }
  });

  test("requires authentication to create projects", () => {
    const gate = createGate();

    expect(gate.allows("project", "create", null)).toBe(false);
    expect(gate.allows("project", "create", { id: 1, role: "member" })).toBe(true);
  });

  test("allows guests to view projects when public reads are enabled", () => {
    process.env.FEATURE_PUBLIC_READS = "true";
    const gate = createGate();

    expect(gate.allows("project", "view", null, project)).toBe(true);
  });

  test("denies guest views when public reads are disabled", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();

    expect(gate.allows("project", "view", null, project)).toBe(false);
  });

  test("allows organization members to view projects in their organizations", () => {
    const gate = createGate();

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("project", "view", { id: 2, role: "member" }, project),
      ),
    ).toBe(true);

    expect(gate.allows("project", "view", { id: 1, role: "admin" }, project)).toBe(true);

    expect(
      withMembership([9], [[9, "member"]], () =>
        gate.allows("project", "view", { id: 2, role: "member" }, project),
      ),
    ).toBe(false);
  });

  test("allows members to update projects and admins to delete them", () => {
    const gate = createGate();

    expect(gate.allows("project", "update", null, project)).toBe(false);
    expect(gate.allows("project", "delete", null, project)).toBe(false);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("project", "update", { id: 2, role: "member" }, project),
      ),
    ).toBe(true);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("project", "delete", { id: 2, role: "member" }, project),
      ),
    ).toBe(false);

    expect(
      withMembership([5], [[5, "admin"]], () =>
        gate.allows("project", "delete", { id: 2, role: "member" }, project),
      ),
    ).toBe(true);

    expect(gate.allows("project", "delete", { id: 1, role: "admin" }, project)).toBe(true);
    expect(gate.allows("project", "update", { id: 1, role: "admin" }, project)).toBe(true);
  });

  test("denies updates for guests", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();
    const policy = new ProjectPolicy();

    expect(gate.allows("project", "update", null, project)).toBe(false);
    expect(policy.create(null)).toBe(false);
    expect(policy.view(null, project)).toBe(false);
    expect(policy.update(null, project)).toBe(false);
    expect(policy.delete(null, project)).toBe(false);
  });
});
