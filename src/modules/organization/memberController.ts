import { resolveMembershipService } from "@getstrata/core/auth/membershipService";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "@getstrata/core/http/response";

class OrganizationMemberController {
  constructor(dependencies: AppDependencies) {
    void dependencies;
  }

  readonly index = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const organizationId = Number.parseInt(params?.id ?? "", 10);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error("Organization id is required.");
    }

    await resolveMembershipService().requireOrgAccess(organizationId, "member");
    const members = await resolveMembershipService().listMembersForOrganization(organizationId);

    return jsonResponse({
      data: members.map((member) => ({
        id: member.id,
        organization_id: member.organization_id,
        user_id: member.user_id,
        role: member.role,
        created_at: member.created_at.toISOString(),
      })),
    });
  });

  readonly store = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const organizationId = Number.parseInt(params?.id ?? "", 10);
    const body = (await request.json()) as { user_id?: number; role?: string };

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error("Organization id is required.");
    }

    const userId = body.user_id;

    if (userId === undefined || !Number.isInteger(userId) || userId <= 0) {
      throw new Error("user_id is required.");
    }

    await resolveMembershipService().requireOrgAccess(organizationId, "admin");

    const member = await resolveMembershipService().addMember({
      organizationId,
      userId,
      role: (body.role as "owner" | "admin" | "member" | undefined) ?? "member",
    });

    return createdResponse({
      id: member.id,
      organization_id: member.organization_id,
      user_id: member.user_id,
      role: member.role,
      created_at: member.created_at.toISOString(),
    });
  });

  readonly destroy = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string; userId?: string } }).params;
    const organizationId = Number.parseInt(params?.id ?? "", 10);
    const userId = Number.parseInt(params?.userId ?? "", 10);

    if (!Number.isInteger(organizationId) || !Number.isInteger(userId)) {
      throw new Error("Organization id and user id are required.");
    }

    await resolveMembershipService().requireOrgAccess(organizationId, "admin");
    await resolveMembershipService().removeMember(organizationId, userId);

    return noContentResponse();
  });

  readonly update = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string; userId?: string } }).params;
    const organizationId = Number.parseInt(params?.id ?? "", 10);
    const userId = Number.parseInt(params?.userId ?? "", 10);

    if (!Number.isInteger(organizationId) || !Number.isInteger(userId)) {
      throw new Error("Organization id and user id are required.");
    }

    const body = (await request.json()) as { role?: string };
    const role = body.role;

    if (role !== "owner" && role !== "admin" && role !== "member") {
      throw new Error("role must be owner, admin, or member.");
    }

    await resolveMembershipService().requireOrgAccess(organizationId, "admin");
    const member = await resolveMembershipService().updateMemberRole(organizationId, userId, role);

    return jsonResponse({
      id: member.id,
      organization_id: member.organization_id,
      user_id: member.user_id,
      role: member.role,
      created_at: member.created_at.toISOString(),
    });
  });
}

export default OrganizationMemberController;
