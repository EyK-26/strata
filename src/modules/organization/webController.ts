import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { isGlobalAdmin, resolveUserId } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { hasMinimumOrgRole } from "@getstrata/core/auth/membershipContext";
import { resolveMembershipService } from "@getstrata/core/auth/membershipService";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { ForbiddenError, ValidationError } from "@getstrata/core/errors/http";
import { requestPrefersJson } from "@getstrata/core/http/contentNegotiation";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";
import { withErrorHandling } from "@getstrata/core/http/response";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse, isHtmxRequest } from "@getstrata/core/view";
import {
  type CurrentOrganizationService,
  currentOrganizationServiceToken,
} from "../user/currentOrganizationService";
import { userRepositoryToken } from "../user/provider";
import type UserRepository from "../user/repository";
import { type OrganizationInvitationService, resolveInvitationService } from "./invitationService";
import { removeOrganizationMember } from "./memberActions";
import { organizationServiceToken } from "./provider";
import { parseOrganizationListQuery } from "./requests";
import type OrganizationService from "./service";
import { personalOrganizationSlug } from "./service";
import {
  parseWebAddOrganizationMemberPayload,
  parseWebCreateOrganizationBody,
  parseWebCreateOrganizationPayload,
  parseWebSwitchCurrentOrganizationPayload,
  parseWebUpdateOrganizationMemberRolePayload,
  parseWebUpdateOrganizationPayload,
} from "./webRequests";

class OrganizationWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): OrganizationService {
    return resolveService(this.dependencies, organizationServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private get users(): UserRepository {
    return resolveService(this.dependencies, userRepositoryToken);
  }

  private get currentOrganization(): CurrentOrganizationService {
    return resolveService(this.dependencies, currentOrganizationServiceToken);
  }

  private get invitations(): OrganizationInvitationService {
    return resolveInvitationService();
  }

  private async pendingInvitationsForAdmin(organizationId: number) {
    try {
      await resolveMembershipService().requireOrgAccess(organizationId, "admin");
      return await this.invitations.listPending(organizationId);
    } catch {
      return [];
    }
  }

  private async membersForOrganization(organizationId: number) {
    const members = await resolveMembershipService().listMembersForOrganization(organizationId);

    return await Promise.all(
      members.map(async (member) => {
        const user = await this.users.findById(member.user_id);

        return {
          ...member,
          email: user?.email ?? `user-${member.user_id}`,
          name: user?.name ?? "Unknown user",
        };
      }),
    );
  }

  private async renderShow(
    request: Request,
    organizationId: number,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const organization = await this.service.findByIdOrThrow(organizationId);
    const members = await this.membersForOrganization(organizationId);
    const invitations = await this.pendingInvitationsForAdmin(organizationId);
    const user = currentAuthUser();
    const currentUserId = user ? resolveUserId(user) : null;
    const canManageMembers = Boolean(
      user && (isGlobalAdmin(user) || hasMinimumOrgRole(organizationId, "admin")),
    );
    const owners = members.filter((member) => member.role === "owner");
    const self = members.find((member) => member.user_id === currentUserId);
    const canLeave = Boolean(
      currentUserId &&
        self &&
        !(self.role === "owner" && owners.length <= 1) &&
        organization.slug !== personalOrganizationSlug(currentUserId),
    );
    const current = currentUserId
      ? await this.currentOrganization.currentForUser(currentUserId)
      : null;
    const isCurrentTeam = current?.organization_id === organization.id;
    const canSwitchToTeam = Boolean(self && !isCurrentTeam);
    const viewData = {
      title: organization.name,
      organization,
      members,
      invitations,
      currentUserId,
      canManageMembers,
      canLeave,
      isCurrentTeam,
      canSwitchToTeam,
      errors: {},
      old: {},
      ...extras,
    };

    if (isHtmxRequest(request) && extras.partial === "members") {
      return htmlResponse(
        await this.view.render("organizations/_members", viewData, { layout: false }),
        { status },
      );
    }

    return htmlResponse(await this.view.render("organizations/show", viewData), { status });
  }

  private async renderIndex(
    request: Request | undefined,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const query = parseOrganizationListQuery(request);
    const result = await this.service.paginate(query);
    const viewData = {
      title: "Organizations",
      organizations: result.data,
      meta: result.meta,
      page: query.page,
      perPage: query.perPage,
      errors: {},
      old: {},
      ...extras,
    };

    if (request && isHtmxRequest(request)) {
      return htmlResponse(
        await this.view.render("organizations/_table", viewData, { layout: false }),
        { status },
      );
    }

    return htmlResponse(await this.view.render("organizations/index", viewData), { status });
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    return await this.renderIndex(request);
  });

  readonly home = withErrorHandling(async () => {
    const user = currentAuthUser();

    if (!user) {
      return Response.redirect("/organizations", 302);
    }

    const location = await this.currentOrganization.resolveHomePath(resolveUserId(user));
    return Response.redirect(location, 302);
  });

  readonly store = withErrorHandling(async (request: Request) => {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const old =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
        ? formDataToRecord(await request.formData())
        : await parseFormBody(request).catch(() => ({}));

    try {
      const body =
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
          ? parseWebCreateOrganizationPayload(old)
          : await parseWebCreateOrganizationBody(request);
      const organization = await this.service.create(body);

      return flashResponse(Response.redirect(`/organizations/${organization.id}`, 302), {
        level: "success",
        message: "Organization created.",
      });
    } catch (error) {
      if (error instanceof ValidationError && request && !requestPrefersJson(request)) {
        return await this.renderIndex(
          request,
          {
            errors: normalizeFieldErrors(error.details),
            old,
          },
          422,
        );
      }

      throw error;
    }
  });

  readonly show = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);

    return await this.renderShow(request, id);
  });

  readonly update = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const old =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
        ? formDataToRecord(await request.formData())
        : await parseFormBody(request).catch(() => ({}));

    try {
      await resolveMembershipService().requireOrgAccess(id, "admin");
      const body = parseWebUpdateOrganizationPayload(old);
      await this.service.update(id, body);

      return flashResponse(Response.redirect(`/organizations/${id}`, 302), {
        level: "success",
        message: "Organization updated.",
      });
    } catch (error) {
      if (error instanceof ValidationError && !requestPrefersJson(request)) {
        return await this.renderShow(
          request,
          id,
          { errors: normalizeFieldErrors(error.details), old },
          422,
        );
      }

      throw error;
    }
  });

  readonly addMember = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const old =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
        ? formDataToRecord(await request.formData())
        : await parseFormBody(request).catch(() => ({}));

    try {
      await resolveMembershipService().requireOrgAccess(id, "admin");
      const body = parseWebAddOrganizationMemberPayload(old);
      const user = await this.users.findByEmail(body.email);
      const actor = currentAuthUser();

      if (!actor) {
        throw new ForbiddenError("Authentication required.");
      }

      if (!user) {
        await this.invitations.invite({
          organizationId: id,
          email: body.email,
          role: body.role,
          invitedByUserId: resolveUserId(actor),
        });

        if (isHtmxRequest(request)) {
          return await this.renderShow(request, id, { partial: "members" });
        }

        return flashResponse(Response.redirect(`/organizations/${id}`, 302), {
          level: "success",
          message: `Invitation sent to ${body.email}.`,
        });
      }

      await resolveMembershipService().addMember({
        organizationId: id,
        userId: user.id,
        role: body.role,
      });

      if (isHtmxRequest(request)) {
        return await this.renderShow(request, id, { partial: "members" });
      }

      return flashResponse(Response.redirect(`/organizations/${id}`, 302), {
        level: "success",
        message: "Member added.",
      });
    } catch (error) {
      if (error instanceof ValidationError && !requestPrefersJson(request)) {
        return await this.renderShow(
          request,
          id,
          { errors: normalizeFieldErrors(error.details), old, partial: "members" },
          422,
        );
      }

      throw error;
    }
  });

  readonly updateMemberRole = withErrorHandling(
    async (request: Request & { params: { id: string; userId: string } }) => {
      const id = Number.parseInt(String(request.params.id), 10);
      const userId = Number.parseInt(String(request.params.userId), 10);
      const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
      const old =
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
          ? formDataToRecord(await request.formData())
          : await parseFormBody(request).catch(() => ({}));

      try {
        await resolveMembershipService().requireOrgAccess(id, "admin");
        const body = parseWebUpdateOrganizationMemberRolePayload(old);
        await resolveMembershipService().updateMemberRole(id, userId, body.role);

        if (isHtmxRequest(request)) {
          return await this.renderShow(request, id, { partial: "members" });
        }

        return flashResponse(Response.redirect(`/organizations/${id}`, 302), {
          level: "success",
          message: "Member role updated.",
        });
      } catch (error) {
        if (error instanceof ValidationError && !requestPrefersJson(request)) {
          return await this.renderShow(
            request,
            id,
            { errors: normalizeFieldErrors(error.details), old, partial: "members" },
            422,
          );
        }

        throw error;
      }
    },
  );

  readonly removeMember = withErrorHandling(
    async (request: Request & { params: { id: string; userId: string } }) => {
      const id = Number.parseInt(String(request.params.id), 10);
      const userId = Number.parseInt(String(request.params.userId), 10);
      const result = await removeOrganizationMember(id, userId);

      if (result.self) {
        const location = await this.currentOrganization.resolveHomePath(userId);
        return flashResponse(Response.redirect(location, 302), {
          level: "success",
          message: "You left the organization.",
        });
      }

      if (isHtmxRequest(request)) {
        return await this.renderShow(request, id, { partial: "members" });
      }

      return flashResponse(Response.redirect(`/organizations/${id}`, 302), {
        level: "success",
        message: "Member removed.",
      });
    },
  );

  readonly cancelInvitation = withErrorHandling(
    async (request: Request & { params: { id: string; invitationId: string } }) => {
      const id = Number.parseInt(String(request.params.id), 10);
      const invitationId = Number.parseInt(String(request.params.invitationId), 10);

      await resolveMembershipService().requireOrgAccess(id, "admin");
      await this.invitations.cancel(id, invitationId);

      if (isHtmxRequest(request)) {
        return await this.renderShow(request, id, { partial: "members" });
      }

      return flashResponse(Response.redirect(`/organizations/${id}`, 302), {
        level: "success",
        message: "Invitation cancelled.",
      });
    },
  );

  readonly acceptInvitation = withErrorHandling(async (request: Request) => {
    const auth = currentAuthUser();

    if (!auth) {
      throw new ForbiddenError("Authentication required.");
    }

    const user = await this.users.findById(resolveUserId(auth));

    if (!user) {
      throw new ForbiddenError("Authentication required.");
    }

    const url = new URL(request.url);
    const member = await this.invitations.accept(
      url.searchParams.get("email") ?? user.email,
      url.searchParams.get("token") ?? "",
      user,
    );

    return flashResponse(Response.redirect(`/organizations/${member.organization_id}`, 302), {
      level: "success",
      message: "You joined the organization.",
    });
  });

  readonly destroy = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);

    await this.service.findByIdOrThrow(id);
    await this.service.delete(id);
    await this.dependencies.cache.tags(CACHE_TAGS.organizations, CACHE_TAGS.reports).flush();

    return flashResponse(Response.redirect("/organizations", 302), {
      level: "success",
      message: "Organization deleted.",
    });
  });

  readonly switchCurrent = withErrorHandling(async (request: Request) => {
    const user = currentAuthUser();

    if (!user) {
      throw new ForbiddenError("Authentication required.");
    }

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const payload =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
        ? formDataToRecord(await request.formData())
        : await parseFormBody(request).catch(() => ({}));
    const body = parseWebSwitchCurrentOrganizationPayload(payload);
    const switched = await this.currentOrganization.switchForUser(
      resolveUserId(user),
      body.organization_id,
    );
    const destination = switched.organization_id
      ? `/organizations/${switched.organization_id}`
      : "/organizations";

    return flashResponse(Response.redirect(destination, 302), {
      level: "success",
      message: "Current organization updated.",
    });
  });
}

export default OrganizationWebController;
