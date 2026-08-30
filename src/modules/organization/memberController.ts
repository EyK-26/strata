import { resolveUserId } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { resolveMembershipService } from "@getstrata/core/auth/membershipService";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { ForbiddenError } from "@getstrata/core/errors/http";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "@getstrata/core/http/response";
import UserRepository from "../user/repository";
import { type OrganizationInvitationService, resolveInvitationService } from "./invitationService";
import { removeOrganizationMember } from "./memberActions";

class OrganizationMemberController {
  constructor(
    dependencies: AppDependencies,
    private readonly invitations: OrganizationInvitationService = resolveInvitationService(),
    private readonly users: UserRepository = new UserRepository(),
  ) {
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

    await removeOrganizationMember(organizationId, userId);

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

  readonly listInvitations = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const organizationId = Number.parseInt(params?.id ?? "", 10);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error("Organization id is required.");
    }

    await resolveMembershipService().requireOrgAccess(organizationId, "member");
    const invitations = await this.invitations.listPending(organizationId);

    return jsonResponse({ data: invitations });
  });

  readonly storeInvitation = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string } }).params;
    const organizationId = Number.parseInt(params?.id ?? "", 10);
    const body = (await request.json()) as { email?: string; role?: string };
    const user = currentAuthUser();

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error("Organization id is required.");
    }

    if (!user) {
      throw new ForbiddenError("Authentication required.");
    }

    await resolveMembershipService().requireOrgAccess(organizationId, "admin");
    const invited = await this.invitations.invite({
      organizationId,
      email: body.email ?? "",
      role: body.role,
      invitedByUserId: resolveUserId(user),
    });

    return createdResponse(invited.invitation);
  });

  readonly destroyInvitation = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: { id?: string; invitationId?: string } })
      .params;
    const organizationId = Number.parseInt(params?.id ?? "", 10);
    const invitationId = Number.parseInt(params?.invitationId ?? "", 10);

    if (!Number.isInteger(organizationId) || !Number.isInteger(invitationId)) {
      throw new Error("Organization id and invitation id are required.");
    }

    await resolveMembershipService().requireOrgAccess(organizationId, "admin");
    await this.invitations.cancel(organizationId, invitationId);

    return noContentResponse();
  });

  readonly acceptInvitation = withErrorHandling(async (request: Request) => {
    const auth = currentAuthUser();

    if (!auth) {
      throw new ForbiddenError("Authentication required.");
    }

    const user = await this.users.findById(resolveUserId(auth));

    if (!user) {
      throw new ForbiddenError("Authentication required.");
    }

    const body = (await request.json()) as { email?: string; token?: string };
    const token = body.token?.trim() ?? "";

    if (!token) {
      throw new Error("token is required.");
    }

    const member = await this.invitations.accept(body.email?.trim() || user.email, token, user);

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
