import { afterEach, describe, expect, test } from "bun:test";
import { membershipContext } from "@getstrata/core/auth/membershipContext";
import { PolicyGate } from "@getstrata/core/auth/policy";
import CommentPolicy from "../../src/modules/comment/policy";
import type { CommentRecord } from "../../src/modules/comment/types";

type CommentWithScope = CommentRecord & { organization_id?: number };

const baseComment: CommentWithScope = {
  id: 1,
  task_id: 10,
  tenant_id: 1,
  body: "Looks good.",
  created_at: new Date(),
  deleted_at: null,
  organization_id: 5,
};

function createGate(): PolicyGate {
  const gate = new PolicyGate();
  gate.register("comment", new CommentPolicy());
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

describe("CommentPolicy", () => {
  const originalPublicReads = process.env.FEATURE_PUBLIC_READS;

  afterEach(() => {
    if (originalPublicReads === undefined) {
      delete process.env.FEATURE_PUBLIC_READS;
    } else {
      process.env.FEATURE_PUBLIC_READS = originalPublicReads;
    }
  });

  test("requires authentication to create comments", () => {
    const gate = createGate();

    expect(gate.allows("comment", "create", null)).toBe(false);
    expect(gate.allows("comment", "create", { id: 1, role: "member" })).toBe(true);
  });

  test("allows guests to view comments when public reads are enabled", () => {
    process.env.FEATURE_PUBLIC_READS = "true";
    const gate = createGate();

    expect(gate.allows("comment", "view", null, baseComment)).toBe(true);
  });

  test("denies guest views when public reads are disabled", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();

    expect(gate.allows("comment", "view", null, baseComment)).toBe(false);
  });

  test("allows global admins to view comments without organization scope", () => {
    const gate = createGate();
    const scopedComment = { ...baseComment, organization_id: undefined };

    expect(gate.allows("comment", "view", { id: 1, role: "admin" }, scopedComment)).toBe(true);
    expect(gate.allows("comment", "view", { id: 2, role: "member" }, scopedComment)).toBe(false);
  });

  test("allows organization members to view comments in their organizations", () => {
    const gate = createGate();

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("comment", "view", { id: 2, role: "member" }, baseComment),
      ),
    ).toBe(true);

    expect(
      withMembership([9], [[9, "member"]], () =>
        gate.allows("comment", "view", { id: 2, role: "member" }, baseComment),
      ),
    ).toBe(false);
  });

  test("allows members to update comments and delete their own organization comments", () => {
    const gate = createGate();

    expect(gate.allows("comment", "update", null, baseComment)).toBe(false);
    expect(gate.allows("comment", "delete", null, baseComment)).toBe(false);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("comment", "update", { id: 2, role: "member" }, baseComment),
      ),
    ).toBe(true);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("comment", "delete", { id: 2, role: "member" }, baseComment),
      ),
    ).toBe(true);
  });

  test("allows global admins to mutate comments without organization scope", () => {
    const gate = createGate();
    const admin = { id: 1, role: "admin" };
    const scopedComment = { ...baseComment, organization_id: undefined };

    expect(gate.allows("comment", "update", admin, scopedComment)).toBe(true);
    expect(gate.allows("comment", "delete", admin, scopedComment)).toBe(true);
    expect(gate.allows("comment", "update", admin, baseComment)).toBe(true);
    expect(gate.allows("comment", "delete", admin, baseComment)).toBe(true);
  });

  test("denies updates for guests and scoped comments outside membership", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();
    const policy = new CommentPolicy();
    const scopedComment = { ...baseComment, organization_id: undefined };

    expect(gate.allows("comment", "update", null, baseComment)).toBe(false);
    expect(gate.allows("comment", "update", { id: 2, role: "member" }, scopedComment)).toBe(false);
    expect(policy.create(null)).toBe(false);
    expect(policy.view(null, baseComment)).toBe(false);
    expect(policy.update(null, baseComment)).toBe(false);
    expect(policy.delete(null, baseComment)).toBe(false);
  });
});
