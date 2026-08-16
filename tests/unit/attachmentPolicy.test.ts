import { afterEach, describe, expect, test } from "bun:test";
import { membershipContext } from "@getstrata/core/auth/membershipContext";
import { PolicyGate } from "@getstrata/core/auth/policy";
import AttachmentPolicy from "../../src/modules/attachment/policy";
import type { AttachmentWithScope } from "../../src/modules/attachment/service";

const attachment: AttachmentWithScope = {
  id: 1,
  task_id: 10,
  tenant_id: 1,
  user_id: 2,
  original_name: "spec.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
  storage_path: "attachments/task-10/spec.pdf",
  created_at: new Date(),
  deleted_at: null,
  organization_id: 5,
};

function createGate(): PolicyGate {
  const gate = new PolicyGate();
  gate.register("attachment", new AttachmentPolicy());
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

describe("AttachmentPolicy", () => {
  const originalPublicReads = process.env.FEATURE_PUBLIC_READS;

  afterEach(() => {
    if (originalPublicReads === undefined) {
      delete process.env.FEATURE_PUBLIC_READS;
    } else {
      process.env.FEATURE_PUBLIC_READS = originalPublicReads;
    }
  });

  test("requires authentication to create attachments", () => {
    const gate = createGate();

    expect(gate.allows("attachment", "create", null)).toBe(false);
    expect(gate.allows("attachment", "create", { id: 1, role: "member" })).toBe(true);
  });

  test("allows guests to view attachments when public reads are enabled", () => {
    process.env.FEATURE_PUBLIC_READS = "true";
    const gate = createGate();

    expect(gate.allows("attachment", "view", null, attachment)).toBe(true);
  });

  test("denies guest views when public reads are disabled", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();

    expect(gate.allows("attachment", "view", null, attachment)).toBe(false);
  });

  test("allows global admins to view attachments without organization scope", () => {
    const gate = createGate();
    const scopedAttachment = { ...attachment, organization_id: undefined };

    expect(gate.allows("attachment", "view", { id: 1, role: "admin" }, scopedAttachment)).toBe(
      true,
    );
    expect(gate.allows("attachment", "view", { id: 2, role: "member" }, scopedAttachment)).toBe(
      false,
    );
  });

  test("allows organization members to view attachments in their organizations", () => {
    const gate = createGate();

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("attachment", "view", { id: 2, role: "member" }, attachment),
      ),
    ).toBe(true);

    expect(
      withMembership([9], [[9, "member"]], () =>
        gate.allows("attachment", "view", { id: 2, role: "member" }, attachment),
      ),
    ).toBe(false);
  });

  test("allows members to delete attachments in their organizations", () => {
    const gate = createGate();

    expect(gate.allows("attachment", "delete", null, attachment)).toBe(false);

    expect(
      withMembership([5], [[5, "member"]], () =>
        gate.allows("attachment", "delete", { id: 2, role: "member" }, attachment),
      ),
    ).toBe(true);

    expect(
      withMembership([9], [[9, "member"]], () =>
        gate.allows("attachment", "delete", { id: 2, role: "member" }, attachment),
      ),
    ).toBe(false);
  });

  test("allows global admins to delete attachments without organization scope", () => {
    const gate = createGate();
    const scopedAttachment = { ...attachment, organization_id: undefined };
    const admin = { id: 1, role: "admin" };

    expect(gate.allows("attachment", "delete", admin, scopedAttachment)).toBe(true);
    expect(gate.allows("attachment", "delete", admin, attachment)).toBe(true);
    expect(gate.allows("attachment", "view", admin, attachment)).toBe(true);
  });

  test("denies attachment updates through the base policy", () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    const gate = createGate();
    const policy = new AttachmentPolicy();

    expect(gate.allows("attachment", "update", { id: 1, role: "admin" }, attachment)).toBe(false);
    expect(policy.create(null)).toBe(false);
    expect(policy.view(null, attachment)).toBe(false);
    expect(policy.update(null, attachment)).toBe(false);
    expect(policy.delete(null, attachment)).toBe(false);
  });
});
