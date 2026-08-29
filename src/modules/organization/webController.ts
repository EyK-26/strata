import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { resolveMembershipService } from "@getstrata/core/auth/membershipService";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { ValidationError } from "@getstrata/core/errors/http";
import { requestPrefersJson } from "@getstrata/core/http/contentNegotiation";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";
import { withErrorHandling } from "@getstrata/core/http/response";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse, isHtmxRequest } from "@getstrata/core/view";
import { userRepositoryToken } from "../user/provider";
import type UserRepository from "../user/repository";
import { organizationServiceToken } from "./provider";
import { parseOrganizationListQuery } from "./requests";
import type OrganizationService from "./service";
import {
  parseWebAddOrganizationMemberPayload,
  parseWebCreateOrganizationBody,
  parseWebCreateOrganizationPayload,
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
    const viewData = {
      title: organization.name,
      organization,
      members,
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
      await this.service.create(body);

      return flashResponse(Response.redirect("/organizations", 302), {
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

      if (!user) {
        throw new ValidationError("No user exists with that email.", {
          email: ["No user exists with that email."],
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

  readonly removeMember = withErrorHandling(
    async (request: Request & { params: { id: string; userId: string } }) => {
      const id = Number.parseInt(String(request.params.id), 10);
      const userId = Number.parseInt(String(request.params.userId), 10);

      await resolveMembershipService().requireOrgAccess(id, "admin");
      await resolveMembershipService().removeMember(id, userId);

      if (isHtmxRequest(request)) {
        return await this.renderShow(request, id, { partial: "members" });
      }

      return flashResponse(Response.redirect(`/organizations/${id}`, 302), {
        level: "success",
        message: "Member removed.",
      });
    },
  );

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
}

export default OrganizationWebController;
