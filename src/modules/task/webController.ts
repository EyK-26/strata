import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
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
import { attachmentServiceToken } from "../attachment/provider";
import type AttachmentService from "../attachment/service";
import { commentServiceToken } from "../comment/provider";
import type CommentService from "../comment/service";
import {
  htmlProjectListQuerySuffix,
  parseHtmlOrganizationIdQuery,
  resolveHtmlProjectListOrganizationId,
} from "../project/listScope";
import { projectServiceToken } from "../project/provider";
import type ProjectService from "../project/service";
import {
  type CurrentOrganizationService,
  currentOrganizationServiceToken,
} from "../user/currentOrganizationService";
import { taskServiceToken } from "./provider";
import { parseTaskListQuery } from "./requests";
import type TaskService from "./service";
import {
  parseWebCreateTaskBody,
  parseWebCreateTaskPayload,
  parseWebUpdateTaskBody,
  parseWebUpdateTaskPayload,
} from "./webRequests";

class TaskWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get attachments(): AttachmentService {
    return resolveService(this.dependencies, attachmentServiceToken);
  }

  private get comments(): CommentService {
    return resolveService(this.dependencies, commentServiceToken);
  }

  private get currentOrganization(): CurrentOrganizationService {
    return resolveService(this.dependencies, currentOrganizationServiceToken);
  }

  private get projects(): ProjectService {
    return resolveService(this.dependencies, projectServiceToken);
  }

  private get service(): TaskService {
    return resolveService(this.dependencies, taskServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private async loadProjects(organizationId?: number) {
    const result = await this.projects.paginate({
      page: 1,
      perPage: 100,
      organizationId,
      includeOrganization: true,
    });

    return result.data;
  }

  private async renderShow(
    taskId: number,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const task = await this.service.findByIdOrThrow(taskId, { includeProject: true });
    const attachments = await this.attachments.listByTaskId(taskId);
    const comments = await this.comments.paginateByTaskId(taskId, { page: 1, perPage: 100 });

    return htmlResponse(
      await this.view.render("tasks/show", {
        title: task.title,
        task,
        attachments,
        comments: comments.data,
        errors: {},
        old: {},
        ...extras,
      }),
      { status },
    );
  }

  private async renderIndex(
    request: Request | undefined,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const query = parseTaskListQuery(request);
    const organizationId = await resolveHtmlProjectListOrganizationId({
      queryOrganizationId: parseHtmlOrganizationIdQuery(request),
      user: currentAuthUser(),
      currentForUser: (userId) => this.currentOrganization.currentForUser(userId),
    });
    const result = await this.service.paginate({
      page: query.page,
      perPage: query.perPage,
      projectId: query.projectId,
      organizationId,
      status: query.status,
      includeProject: true,
    });
    const projects = await this.loadProjects(organizationId);
    const viewData = {
      title: "Tasks",
      tasks: result.data,
      meta: result.meta,
      page: query.page,
      perPage: query.perPage,
      projects,
      currentOrganizationId: organizationId,
      defaultProjectId: projects[0]?.id,
      listQuerySuffix: htmlProjectListQuerySuffix({
        organizationId,
        projectId: query.projectId,
        status: query.status,
      }),
      errors: {},
      old: {},
      ...extras,
    };

    if (request && isHtmxRequest(request)) {
      return htmlResponse(await this.view.render("tasks/_table", viewData, { layout: false }), {
        status,
      });
    }

    return htmlResponse(await this.view.render("tasks/index", viewData), { status });
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
          ? parseWebCreateTaskPayload(old)
          : await parseWebCreateTaskBody(request);
      await this.service.create(body);

      return flashResponse(Response.redirect("/tasks", 302), {
        level: "success",
        message: "Task created.",
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

    return await this.renderShow(id);
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
      const body =
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
          ? parseWebUpdateTaskPayload(old)
          : await parseWebUpdateTaskBody(request);
      await this.service.update(id, body);

      if (isHtmxRequest(request)) {
        return await this.renderShow(id);
      }

      return flashResponse(Response.redirect(`/tasks/${id}`, 302), {
        level: "success",
        message: "Task updated.",
      });
    } catch (error) {
      if (error instanceof ValidationError && request && !requestPrefersJson(request)) {
        return await this.renderShow(
          id,
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

  readonly destroy = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);
    await this.service.delete(id);

    return flashResponse(Response.redirect("/tasks", 302), {
      level: "success",
      message: "Task deleted.",
    });
  });
}

export default TaskWebController;
