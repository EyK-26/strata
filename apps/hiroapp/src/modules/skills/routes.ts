import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { NamedResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { ROLE } from "../../lib/roles.ts";
import { Department } from "../../models/Department.ts";
import { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { skills } from "./repository.ts";
import {
  InterviewersRequest,
  SyncPositionSkillsRequest,
  SyncUserSkillsRequest,
} from "./requests.ts";

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
        const model = User.newFromRecord(user);
        await model.skills().detach();
        for (const skill of payload.skills) {
          await model
            .skills()
            .withPivotValues({ years: skill.years, level: skill.level })
            .attach(skill.skill_id);
        }
        return jsonResponse(namedCollection(await model.skills()));
      }),
    },
    "/api/me/watching": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const rows = await User.newFromRecord(user).watching();
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
            await User.newFromRecord(user).watching().toggle(position.id);
            return jsonResponse({ watching: await User.newFromRecord(user).watching().count() });
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
            await authorize(request, "skills", "update");
            const payload = await new SyncPositionSkillsRequest().validate(request);
            await position.skills().detach();
            for (const skill of payload.skills) {
              await position
                .skills()
                .withPivotValues({ required: skill.required, weight: skill.weight })
                .attach(skill.skill_id);
            }
            return jsonResponse(namedCollection(await position.skills()));
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
            const required = await position.skills();
            const requiredIds = new Set(required.map((skill) => Number(skill.id)));
            const candidates = await User.where({ role_id: ROLE.CANDIDATE }).get();
            const matches = [];
            for (const candidate of candidates) {
              const owned = await candidate.skills();
              const ownedIds = new Set(owned.map((skill) => Number(skill.id)));
              const hit = [...requiredIds].filter((skillId) => ownedIds.has(skillId)).length;
              matches.push({
                user: candidate.toArray(),
                matched: hit,
                required: requiredIds.size,
              });
            }
            matches.sort((left, right) => right.matched - left.matched);
            return jsonResponse(matches);
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
            return jsonResponse((await position.interviewers()).map((row) => row.toArray()));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "skills", "update");
            const payload = await new InterviewersRequest().validate(request);
            await position
              .interviewers()
              .withPivotValues({ role: payload.role })
              .sync(payload.user_ids);
            return jsonResponse((await position.interviewers()).map((row) => row.toArray()));
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
