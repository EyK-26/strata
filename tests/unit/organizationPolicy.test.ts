import { afterEach, describe, expect, test } from "bun:test";
import { membershipContext } from "@getstrata/core/auth/membershipContext";
import { PolicyGate } from "@getstrata/core/auth/policy";
import OrganizationPolicy from "../../src/modules/organization/policy";
import type { OrganizationRecord } from "../../src/modules/organization/types";

const organization: OrganizationRecord = {
  id: 5,
  tenant_id: 1,
  name: "Acme Labs",
  slug: "acme-labs",
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

const protectedOrganization: OrganizationRecord = {
  ...organization,
  id: 2,
  slug: "protected-org",
};

function createGate(): PolicyGate {
  const gate = new PolicyGate();
  gate.register("organization", new OrganizationPolicy());
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

describe("OrganizationPolicy", () => {
  const originalPublicReads = process.env.FEATURE_PUBLIC_READS;

  afterEach(() => {
    if (originalPublicReads === undefined) {
      delete process.env.FEATURE_PUBLIC_READS;
    } else {
      process.env.FEATURE_PUBLIC_READS = originalPublicReads;
    }
  });

  test("requires authentication to create organizations", () => {
    const gate = createGate();

    expect(gate.allows("organization", "create", null)).toBe(false);
    expect(gate.allows("organization", "create", { id: 1, role: "member" })).toBe(true);
  });

  test("allows guests to view organizations when public reads are enabled", () => {
    process.env.FEATURE_PUBLIC_READS = "true";
    const gate = createGate();

    expect(gate.allows("organization", "view", null, organization)).toBe(true);
  });

  test("allows members to view organizations in their memberships", () => {
    const gate = createGate();

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("organization", "view", { id: 2, role: "member" }, organization),
      ),
    ).toBe(true);

    expect(
      withMembership([9], [[9, "member"]], () =>
        gate.allows("organization", "view", { id: 2, role: "member" }, organization),
      ),
    ).toBe(false);
  });

  test("requires authentication to update organizations", () => {
    const gate = createGate();

    expect(gate.allows("organization", "update", null, organization)).toBe(false);
  });

  test("allows organization admins to update their organizations", () => {
    const gate = createGate();

    expect(
      withMembership([5], [[5, "admin"]], () =>
        gate.allows("organization", "update", { id: 2, role: "member" }, organization),
      ),
    ).toBe(true);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("organization", "update", { id: 2, role: "member" }, organization),
      ),
    ).toBe(false);
  });

  test("protects the protected-org slug unless the user is a global admin", () => {
    const gate = createGate();

    expect(
      gate.allows("organization", "delete", { id: 2, role: "member" }, protectedOrganization),
    ).toBe(false);
    expect(
      gate.allows("organization", "delete", { id: 1, role: "admin" }, protectedOrganization),
    ).toBe(true);
  });

  test("allows owners to delete regular organizations", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();
    const policy = new OrganizationPolicy();

    expect(
      withMembership([5], [[5, "owner"]], () =>
        gate.allows("organization", "delete", { id: 2, role: "member" }, organization),
      ),
    ).toBe(true);

    expect(policy.create(null)).toBe(false);
    expect(policy.create({ id: 1, role: "member" })).toBe(true);
    expect(
      withMembership([5], [[5, "member"]], () =>
        policy.view({ id: 2, role: "member" }, organization),
      ),
    ).toBe(true);
    expect(
      withMembership([5], [[5, "admin"]], () =>
        policy.update({ id: 2, role: "member" }, organization),
      ),
    ).toBe(true);
    expect(policy.view(null, organization)).toBe(false);
    expect(policy.update(null, organization)).toBe(false);
    expect(policy.delete(null, organization)).toBe(false);
  });
});
