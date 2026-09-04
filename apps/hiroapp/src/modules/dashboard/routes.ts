import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { jsonResponse } from "@getstrata/core/http/response";
import {
  getQueryParams,
  parseOptionalBooleanQueryParam,
  parsePositiveIntParam,
} from "@getstrata/core/http/validation";
import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import { authorize, denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import {
  ApplicationResource,
  mergeResource,
  NamedResource,
  PositionResource,
  UserResource,
} from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isAdmin, STATUS } from "../../lib/roles.ts";
import { applications } from "../applications/repository.ts";
import { statuses } from "../catalog/repository.ts";
import { positions } from "../positions/repository.ts";
import { users } from "../users/repository.ts";

async function dashboardRows(request: Request) {
  const params = getQueryParams(request);
  const departmentId = Number(params.get("department_id") ?? 0);
  const positionIds = departmentId ? await positions.idsInDepartment(departmentId) : [];
  const extra: Record<string, unknown> = {};
  if (parseOptionalBooleanQueryParam(params, "isFeedbackRestricted"))
    extra.status_id = STATUS.FEEDBACK;
  if (parseOptionalBooleanQueryParam(params, "isHiredRestricted")) extra.status_id = STATUS.HIRED;
  if (parseOptionalBooleanQueryParam(params, "isRejectedRestricted"))
    extra.status_id = STATUS.ENDED;
  if (parseOptionalBooleanQueryParam(params, "isInterviewRestricted"))
    extra.status_id = STATUS.INTERVIEW;
  if (parseOptionalBooleanQueryParam(params, "isMonthRestricted")) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    extra.created_at = { gte: start };
  }
  return applications.forPositions(positionIds, extra);
}

export function dashboardRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/dashboard/count": {
      GET: wrapApi(dependencies, async (request) => {
        await authorize(request, "dashboard", "view");
        const rows = await dashboardRows(request);
        return jsonResponse(rows.length);
      }),
    },
    "/api/dashboard/data": {
      GET: wrapApi(dependencies, async (request) => {
        await authorize(request, "dashboard", "view");
        const rows = await dashboardRows(request);
        const payload = await Promise.all(
          rows.map(async (application) => {
            const user = await users.findById(application.user_id);
            const position = application.position_id
              ? await positions.findById(application.position_id)
              : null;
            const status = await statuses.findById(application.status_id);
            return mergeResource(new ApplicationResource(application), {
              user: user ? new UserResource(user).toArray() : null,
              position: position ? new PositionResource(position).toArray() : null,
              status: status ? new NamedResource(status).toArray() : null,
            });
          }),
        );
        return jsonResponse(payload);
      }),
    },
    "/api/failed-jobs": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isAdmin(user.role_id));
        const failedJobs =
          dependencies.container.resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN);
        return jsonResponse(
          (await failedJobs.listRecent(50)).map((job) => ({
            id: Number(job.id),
            job_name: job.job_name,
            exception: job.exception,
            failed_at: job.failed_at,
          })),
        );
      }),
    },
    "/api/failed-jobs/:id/retry": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isAdmin(user.role_id));
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const failedJobs =
          dependencies.container.resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN);
        const retried = await failedJobs.retry(id);
        return jsonResponse({ retried: true, id: Number(retried.id), job_name: retried.job_name });
      }),
    },
  };
}
