import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { hashPassword } from "@getstrata/core/auth/password";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { authorize, denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import {
  loadApplicationDetail,
  loadCandidatePosition,
  loadPositionWithApplications,
  loadUserDetail,
  loadUserGraph,
} from "../../lib/loaders.ts";
import { isAdmin, isCandidate, isRecruiter, ROLE } from "../../lib/roles.ts";
import {
  serializeApplication,
  serializeNamed,
  serializePosition,
  serializeUser,
} from "../../lib/serialize.ts";
import { resolveStaffDepartmentId } from "../../lib/staffTeam.ts";
import { Application } from "../../models/Application.ts";
import { Position } from "../../models/Position.ts";
import type { Status } from "../../models/Status.ts";
import { User } from "../../models/User.ts";
import { applications } from "../applications/repository.ts";
import { ApplicationIndexRequest } from "../applications/requests.ts";
import { applicationService } from "../applications/service.ts";
import { statuses } from "../catalog/repository.ts";
import { departments } from "../departments/repository.ts";
import { inboxService } from "../notifications/inbox.ts";
import { interviewNotification, notifyUser } from "../notifications/service.ts";
import { interviewerService } from "../positions/interviewers.ts";
import { positions } from "../positions/repository.ts";
import { positionService } from "../positions/service.ts";
import { users } from "../users/repository.ts";

function serializeLoadedApplication(application: Application) {
  const position = application.loaded<Position>("position");
  const status = application.loaded<Status>("status");
  const applicant = application.loaded<User>("user");
  return serializeApplication(application, {
    position: position ? serializePosition(position) : null,
    status: status ? serializeNamed(status) : null,
    user: applicant ? serializeUser(applicant) : null,
  });
}

async function homeFor(request: Request) {
  const user = await requireCurrentUser(request);
  if (isAdmin(user.role_id)) {
    const open = await positions.hiring();
    const allUsers = await users.findAll({ orderBy: { column: "last_name", direction: "ASC" } });
    const openPayload = await Promise.all(
      open.map(async (position) =>
        serializePosition(position, {
          applications: (await applications.forPosition(position.id)).map((row) =>
            serializeApplication(row),
          ),
        }),
      ),
    );
    const userPayload = await Promise.all(
      allUsers.map(async (row) => {
        const graph = await loadUserGraph(row);
        return serializeUser(row, { position: graph.position });
      }),
    );
    return renderPage(request, "admin/home", { positions: openPayload, users: userPayload });
  }
  if (isRecruiter(user.role_id)) {
    const summary = await applicationService.summaryForActor(user);
    const recent = await applicationService.listForActor(user, {}, { page: 1, perPage: 20 });
    return renderPage(request, "recruiter/home", {
      summary,
      applications: recent.map((application) => serializeLoadedApplication(application)),
      title: "Hiring pipeline",
    });
  }
  const apps = await applicationService.listForActor(user, {}, { page: 1, perPage: 50 });
  const open = await positions.hiring();
  const appPayload = apps.map((application) =>
    serializeLoadedApplication(application as Application),
  );
  const appliedIds = new Set(apps.map((row) => Number(row.get("position_id"))));
  const openPayload = open
    .filter((position) => !appliedIds.has(Number(position.id)))
    .map((position) => serializePosition(position));
  return renderPage(request, "candidate/home", {
    applications: appPayload,
    positions: openPayload,
  });
}

export function htmlRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/": {
      GET: wrapWebAuthenticated(dependencies, homeFor),
    },
    "/users": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "users", "view");
        const allUsers = await users.findAll({
          orderBy: { column: "last_name", direction: "ASC" },
        });
        const payload = await Promise.all(
          allUsers.map(async (row) => {
            const graph = await loadUserGraph(row);
            return serializeUser(row, { position: graph.position });
          }),
        );
        return renderPage(request, "admin/users", { users: payload });
      }),
    },
    "/users/create": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "users", "create");
        const hiring = await positions.hiring();
        return renderPage(request, "admin/create-user", {
          departments: (await departments.ordered()).map(serializeNamed),
          positions: hiring.map((row) => ({
            id: row.id,
            name: row.name,
            department_id: row.department_id,
          })),
        });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "users", "create");
        const { fields } = await parseFormBody(request);
        const first = fields.first_name?.trim() ?? "";
        const last = fields.last_name?.trim() ?? "";
        const positionId = Number(fields.position_id);
        const roleId = Number(fields.role_id);
        const base = `${first}.${last}`.toLowerCase();
        let email = `${base}@hiroapp.com`;
        if (await users.findByEmail(email)) {
          email = `${base}${await users.countByEmailPrefix(base)}@hiroapp.com`;
        }
        const created = await users.create({
          first_name: first,
          last_name: last,
          email,
          password: await hashPassword("password"),
          role_id: roleId,
        });
        if (positionId) {
          await positions.updateById(positionId, { user_id: created.id });
        }
        return redirectResponse(`/users/${created.id}`);
      }),
    },
    "/users/:id": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => User.findOrFail(id),
          async (request, user) => {
            await authorize(request, "users", "view");
            return renderPage(request, "users/show", await loadUserDetail(Number(user.id)));
          },
        ),
      ),
    },
    "/users/:id/delete": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => User.findOrFail(id),
          async (request, target) => {
            await authorize(request, "users", "delete");
            const seat = await target.position().first();
            if (seat) await positions.updateById(Number(seat.id), { user_id: null });
            await users.deleteById(Number(target.id));
            return redirectResponse("/users");
          },
        ),
      ),
    },
    "/positions": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await authorize(request, "positions", "view");
        let departmentId: number | undefined;
        if (isRecruiter(user.role_id)) {
          departmentId = (await resolveStaffDepartmentId(user)) ?? undefined;
        }
        const rows = await positions.hiring({ departmentId });
        const payload = await Promise.all(
          rows.map(async (position) =>
            serializePosition(position, {
              applications: (await applications.forPosition(position.id)).map((row) =>
                serializeApplication(row),
              ),
            }),
          ),
        );
        return renderPage(request, "positions/index", { positions: payload, roleId: user.role_id });
      }),
    },
    "/positions/:id": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const user = await authorize(request, "positions", "view");
            const id = Number(position.id);
            if (isCandidate(user.role_id)) {
              return renderPage(request, "positions/show-candidate", {
                position: await loadCandidatePosition(id),
              });
            }
            return renderPage(request, "positions/show", await loadPositionWithApplications(id));
          },
        ),
      ),
    },
    "/positions/:id/close": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "positions", "update");
            await positionService.close(actor, position);
            return redirectResponse(`/positions/${position.id}`);
          },
        ),
      ),
    },
    "/positions/:id/interviewers": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "positions", "update");
            const { fields } = await parseFormBody(request);
            const userIds = String(fields.user_ids ?? "")
              .split(",")
              .map((value) => Number(value.trim()));
            await interviewerService.sync(actor, position, {
              user_ids: userIds,
              role: fields.role,
            });
            return redirectResponse(`/positions/${position.id}`);
          },
        ),
      ),
    },
    "/positions/:id/reopen": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "positions", "update");
            await positionService.reopen(actor, position);
            return redirectResponse(`/positions/${position.id}`);
          },
        ),
      ),
    },
    "/positions/:id/delete": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "positions", "delete");
            await positionService.remove(actor, position);
            return redirectResponse("/positions");
          },
        ),
      ),
    },
    "/position/create": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await authorize(request, "positions", "create");
        return renderPage(request, "positions/create", {
          names: await positions.distinctNames(),
          department_id: (await resolveStaffDepartmentId(user)) ?? "",
        });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await authorize(request, "positions", "create");
        const { fields } = await parseFormBody(request);
        const created = await positionService.create(user, {
          name: fields.name ?? "",
          description: fields.description || null,
          start_date: fields.start_date || null,
          end_date: fields.end_date || null,
          pay_grade: Number(fields.pay_grade),
          department_id: Number(fields.department_id),
        });
        return redirectResponse(`/positions/${created.id}`);
      }),
    },
    "/applications": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const query = new ApplicationIndexRequest().validate(request);
        const rows = await applicationService.listForActor(user, query, { page: 1, perPage: 50 });
        const payload = rows.map((application) => serializeLoadedApplication(application));
        return renderPage(request, "applications/index", {
          applications: payload,
          title: isCandidate(user.role_id) ? "Your Applications" : "Hiring pipeline",
        });
      }),
    },
    "/applications/:id": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const user = await authorize(request, "applications", "view", application.toObject());
            return renderPage(request, "applications/show", {
              ...(await loadApplicationDetail(Number(application.id))),
              roleId: user.role_id,
            });
          },
        ),
      ),
    },
    "/applications/:id/move": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, bound) => {
            const actor = await authorize(request, "applications", "update");
            await applicationService.move(actor, bound);
            return redirectResponse(`/applications/${bound.id}`);
          },
        ),
      ),
    },
    "/applications/:id/end": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, bound) => {
            const actor = await requireCurrentUser(request);
            await authorize(request, "applications", "delete", bound.toObject());
            await applicationService.end(actor, bound);
            return redirectResponse(`/applications/${bound.id}`);
          },
        ),
      ),
    },
    "/applications/notify": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const { fields } = await parseFormBody(request);
        const applicant = await users.findByIdOrThrow(Number(fields.applicant_id));
        await notifyUser({
          userId: applicant.id,
          ...interviewNotification({
            text: fields.text ?? "",
            datetime: fields.datetime ?? "",
            place: fields.place ?? "",
            sender: {
              first_name: actor.first_name,
              last_name: actor.last_name,
              email: actor.email,
            },
            to: applicant.email,
          }),
        });
        return redirectResponse(fields.return_to || "/");
      }),
    },
    "/apply/:id": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const user = await requireCurrentUser(request);
            if (user.role_id !== ROLE.CANDIDATE) {
              return redirectResponse("/");
            }
            return renderPage(request, "applications/apply", { position_id: Number(position.id) });
          },
        ),
      ),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await authorize(request, "applications", "create");
        const { fields } = await parseFormBody(request);
        const created = await applicationService.apply(user, {
          position_id: Number(fields.position_id),
          attachment_text: fields.attachment_text || null,
          attachment_file: fields.attachment_file || null,
        });
        return redirectResponse(`/applications/${created.id}`);
      }),
    },
    "/hirings": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const departmentId = await resolveStaffDepartmentId(user);
        const rows = departmentId ? await positions.hiring({ departmentId }) : [];
        const payload = await Promise.all(
          rows.map(async (position) =>
            serializePosition(position, {
              applications: (await applications.forPosition(position.id)).map((row) =>
                serializeApplication(row),
              ),
            }),
          ),
        );
        return renderPage(request, "recruiter/hirings", { positions: payload });
      }),
    },
    "/dashboard": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "dashboard", "view");
        const user = await requireCurrentUser(request);
        const departmentId = await resolveStaffDepartmentId(user);
        const positionIds = departmentId ? await positions.idsInDepartment(departmentId) : [];
        const rows = await applications.forPositions(positionIds);
        return renderPage(request, "recruiter/dashboard", {
          count: rows.length,
          applications: await Promise.all(
            rows.map(async (application) => {
              const applicant = await users.findById(application.user_id);
              const position = application.position_id
                ? await positions.findById(application.position_id)
                : null;
              const status = await statuses.findById(application.status_id);
              return serializeApplication(application, {
                user: applicant ? serializeUser(applicant) : null,
                position: position ? serializePosition(position) : null,
                status: status ? serializeNamed(status) : null,
              });
            }),
          ),
        });
      }),
    },
    "/applications/:id/withdraw": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            await authorize(request, "applications", "delete", application.toObject());
            await application.delete();
            return redirectResponse("/applications");
          },
        ),
      ),
    },
    "/failed-jobs": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isAdmin(user.role_id));
        const failedJobs =
          dependencies.container.resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN);
        return renderPage(request, "admin/failed-jobs", {
          jobs: (await failedJobs.listRecent(50)).map((job) => ({
            id: Number(job.id),
            job_name: job.job_name,
            exception: job.exception,
            failed_at: job.failed_at,
          })),
        });
      }),
    },
    "/failed-jobs/:id/retry": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isAdmin(user.role_id));
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const failedJobs =
          dependencies.container.resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN);
        await failedJobs.retry(id);
        return redirectResponse("/failed-jobs");
      }),
    },
    "/notify": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const { fields } = await parseFormBody(request);
        await inboxService.contact({
          to: fields.to ?? "",
          from: fields.from ?? "",
          subject: fields.subject ?? "",
          text: fields.text ?? "",
        });
        return redirectResponse(fields.return_to || "/");
      }),
    },
  };
}
