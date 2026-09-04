import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { NamedResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Department } from "../../models/Department.ts";
import { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { interviewerService } from "../positions/interviewers.ts";
import { watchlistService } from "../positions/watchlist.ts";
import { skills } from "./repository.ts";
import {
  InterviewersRequest,
  SyncPositionSkillsRequest,
  SyncUserSkillsRequest,
} from "./requests.ts";
import { skillService } from "./service.ts";

function namedCollection(rows: Array<{ toArray?: () => Record<string, unknown> }>) {
  return NamedResource.collection(rows.map((row) => new NamedResource(row))).toResponse();
}

export function skillRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/skills": {
      GET: wrapApi(dependencies, async (request) => {
        await authorize(request, "skills", "view");
        return jsonResponse(namedCollection(await skills.ordered()));
      }),
    },
    "/api/me/skills": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        return jsonResponse(namedCollection(await User.newFromRecord(user).skills()));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const user = await authorize(request, "skills", "create");
        const payload = await new SyncUserSkillsRequest().validate(request);
        return jsonResponse(
          namedCollection(await skillService.replaceUserSkills(user, payload.skills)),
        );
      }),
    },
    "/api/me/watching": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const rows = await watchlistService.list(user);
        return jsonResponse(rows.map((row) => row.toArray()));
      }),
    },
    "/api/positions/:id/watch": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const user = await requireCurrentUser(request);
            const result = await watchlistService.toggle(user, position);
            return jsonResponse({ watching: result.count });
          },
        ),
      ),
    },
    "/api/positions/:id/skills": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "skills", "view");
            return jsonResponse(namedCollection(await position.skills()));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "skills", "update");
            const payload = await new SyncPositionSkillsRequest().validate(request);
            const rows = await skillService.replacePositionSkills(actor, position, payload.skills);
            return jsonResponse(namedCollection(rows));
          },
        ),
      ),
    },
    "/api/positions/:id/match": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "skills", "update");
            const matches = await skillService.matchCandidates(position);
            return jsonResponse(matches.map((row) => skillService.presentMatchApi(row)));
          },
        ),
      ),
    },
    "/api/positions/:id/interviewers": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "skills", "view");
            const rows = await interviewerService.list(position);
            return jsonResponse(rows.map((row) => row.toArray()));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "skills", "update");
            const payload = await new InterviewersRequest().validate(request);
            const rows = await interviewerService.sync(actor, position, payload);
            return jsonResponse(rows.map((row) => row.toArray()));
          },
        ),
      ),
    },
    "/api/departments/:id/applications": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            await authorize(request, "skills", "view");
            const rows = await department.applications();
            return jsonResponse({
              count: rows.length,
              data: rows.map((row) => row.toArray()),
            });
          },
        ),
      ),
    },
  };
}
