import { beforeEach, describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import MembershipService from "@getstrata/core/auth/membershipService";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { resolveApplicationDependencies } from "@getstrata/core/runtime/applicationRegistry";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { removeOrganizationMember } from "../../src/modules/organization/memberActions";
import OrganizationMemberRepository from "../../src/modules/organization/memberRepository";
import OrganizationRepository from "../../src/modules/organization/repository";
import { personalOrganizationSlug } from "../../src/modules/organization/service";
import UserRepository from "../../src/modules/user/repository";
import { defaultTestTenant } from "./testHelpers";

function useRealMembershipService(): void {
  try {
    resolveApplicationDependencies().container.set("core.membership", new MembershipService());
  } catch {
    // No active app context — resolveMembershipService() constructs MembershipService.
  }
}

async function createLeaveFixture(slug = `leave-${Date.now()}`) {
  const users = new UserRepository();
  const organizations = new OrganizationRepository();
  const members = new OrganizationMemberRepository();
  const owner = await users.create({
    name: "Leave Owner",
    email: `leave-owner-${Date.now()}@workhub.test`,
    role: "member",
    tenant_id: defaultTestTenant.id,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const member = await users.create({
    name: "Leave Member",
    email: `leave-member-${Date.now()}@workhub.test`,
    role: "member",
    tenant_id: defaultTestTenant.id,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const organization = await organizations.create({
    tenant_id: defaultTestTenant.id,
    name: "Leave Team",
    slug,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await members.addMember({ organizationId: organization.id, userId: owner.id, role: "owner" });
  await members.addMember({ organizationId: organization.id, userId: member.id, role: "member" });

  return { users, members, owner, member, organization };
}

describe("removeOrganizationMember", () => {
  beforeEach(() => {
    useRealMembershipService();
  });

  test("lets a member leave and clears current organization", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const { users, members, owner, member, organization } = await createLeaveFixture();
      await users.updateByIdOrThrow(member.id, { current_organization_id: organization.id });

      const result = await runWithAuthUser({ id: member.id, role: "member" }, () =>
        removeOrganizationMember(organization.id, member.id),
      );

      expect(result).toEqual({ self: true });
      expect(await members.findMembership(member.id, organization.id)).toBeNull();
      expect(await members.findMembership(owner.id, organization.id)).not.toBeNull();
      expect((await users.findByIdOrThrow(member.id)).current_organization_id).toBeNull();
    });
  });

  test("lets an org admin remove another member", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const { members, owner, member, organization } = await createLeaveFixture();

      const result = await runWithAuthUser({ id: owner.id, role: "member" }, () =>
        removeOrganizationMember(organization.id, member.id),
      );

      expect(result).toEqual({ self: false });
      expect(await members.findMembership(member.id, organization.id)).toBeNull();
    });
  });

  test("rejects guests, missing memberships, last owners, and personal workspaces", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const { owner, member, organization } = await createLeaveFixture();

      await expect(removeOrganizationMember(organization.id, member.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await expect(
        runWithAuthUser({ id: member.id, role: "member" }, () =>
          removeOrganizationMember(organization.id, 999_999),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        runWithAuthUser({ id: member.id, role: "member" }, () =>
          removeOrganizationMember(organization.id, owner.id),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        runWithAuthUser({ id: owner.id, role: "member" }, () =>
          removeOrganizationMember(organization.id, owner.id),
        ),
      ).rejects.toMatchObject({ message: "Cannot leave as the last owner." });

      await expect(
        runWithAuthUser({ id: 1, role: "admin" }, () =>
          removeOrganizationMember(organization.id, owner.id),
        ),
      ).rejects.toMatchObject({ message: "Cannot remove the last owner." });

      const personal = await createLeaveFixture();
      await new OrganizationRepository().updateByIdOrThrow(personal.organization.id, {
        slug: personalOrganizationSlug(personal.owner.id),
      });
      await personal.members.updateMemberRole(
        personal.organization.id,
        personal.member.id,
        "owner",
      );
      await expect(
        runWithAuthUser({ id: personal.owner.id, role: "member" }, () =>
          removeOrganizationMember(personal.organization.id, personal.owner.id),
        ),
      ).rejects.toMatchObject({ message: "Cannot leave your personal workspace." });
    });
  });
});
