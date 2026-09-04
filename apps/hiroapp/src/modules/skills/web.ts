import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { redirectResponse } from "@getstrata/core/view";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { ROLE } from "../../lib/roles.ts";
import { serializeNamed, serializePosition } from "../../lib/serialize.ts";
import { Department } from "../../models/Department.ts";
import { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { skills } from "./repository.ts";

export function skillWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/skills": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const catalog = (await skills.ordered()).map(serializeNamed);
        const owned = (await User.newFromRecord(user).skills()).map((row) => ({
          ...serializeNamed(row),
          years: Number((row as { get: (key: string) => unknown }).get("years") ?? 0),
          level: String((row as { get: (key: string) => unknown }).get("level") ?? "intermediate"),
        }));
        return renderPage(request, "skills/index", { catalog, owned });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await authorize(request, "skills", "create");
        const { fields } = await parseFormBody(request);
        const skillIds = String(fields.skill_ids ?? "")
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((id) => Number.isInteger(id) && id > 0);
        const model = User.newFromRecord(user);
        await model.skills().detach();
        for (const skillId of skillIds) {
          await model.skills().withPivotValues({ years: 1, level: "intermediate" }).attach(skillId);
        }
        return redirectResponse("/skills");
      }),
    },
    "/watching": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const rows = await User.newFromRecord(user).watching();
        return renderPage(request, "skills/watching", {
          positions: rows.map((row) => serializePosition(row)),
        });
      }),
    },
    "/positions/:id/watch": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const position = await Position.findOrFail(id);
        await User.newFromRecord(user).watching().toggle(position.id);
        return redirectResponse(`/positions/${id}`);
      }),
    },
    "/positions/:id/skills": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "skills", "view");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const position = await Position.findOrFail(id);
        const catalog = (await skills.ordered()).map(serializeNamed);
        const attached = (await position.skills()).map(serializeNamed);
        return renderPage(request, "skills/position", {
          position: serializePosition(position),
          catalog,
          attached,
        });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "skills", "update");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const { fields } = await parseFormBody(request);
        const skillIds = String(fields.skill_ids ?? "")
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((skillId) => Number.isInteger(skillId) && skillId > 0);
        const position = await Position.findOrFail(id);
        await position.skills().detach();
        for (const skillId of skillIds) {
          await position.skills().withPivotValues({ required: true, weight: 1 }).attach(skillId);
        }
        return redirectResponse(`/positions/${id}/skills`);
      }),
    },
    "/positions/:id/match": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "skills", "update");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const position = await Position.findOrFail(id);
        const required = await position.skills();
        const requiredIds = new Set(required.map((skill) => Number(skill.id)));
        const candidates = await User.where({ role_id: ROLE.CANDIDATE }).get();
        const matches = [];
        for (const candidate of candidates) {
          const owned = await candidate.skills();
          const ownedIds = new Set(owned.map((skill) => Number(skill.id)));
          const hit = [...requiredIds].filter((skillId) => ownedIds.has(skillId)).length;
          matches.push({
            id: candidate.id,
            first_name: candidate.get("first_name"),
            last_name: candidate.get("last_name"),
            matched: hit,
            required: requiredIds.size,
          });
        }
        matches.sort((left, right) => right.matched - left.matched);
        return renderPage(request, "skills/match", {
          position: serializePosition(position),
          matches,
        });
      }),
    },
    "/departments/:id/applications": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "skills", "view");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const department = await Department.findOrFail(id);
        const rows = await department.applications();
        return renderPage(request, "departments/applications", {
          department: serializeNamed(department),
          count: rows.length,
          applications: rows.map((row) => row.toArray()),
        });
      }),
    },
  };
}
