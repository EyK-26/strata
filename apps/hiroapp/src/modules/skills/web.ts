import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { serializeNamed, serializePosition } from "../../lib/serialize.ts";
import { Department } from "../../models/Department.ts";
import { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { watchlistService } from "../positions/watchlist.ts";
import { skills } from "./repository.ts";
import { parseSkillIds, skillService } from "./service.ts";

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
        const items = parseSkillIds(fields.skill_ids).map((skill_id) => ({
          skill_id,
          years: 1,
          level: "intermediate",
        }));
        await skillService.replaceUserSkills(user, items);
        return redirectResponse("/skills");
      }),
    },
    "/watching": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const rows = await watchlistService.list(user);
        return renderPage(request, "skills/watching", {
          positions: rows.map((row) => serializePosition(row)),
        });
      }),
    },
    "/positions/:id/watch": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const user = await requireCurrentUser(request);
            await watchlistService.toggle(user, position);
            return redirectResponse(`/positions/${position.id}`);
          },
        ),
      ),
    },
    "/positions/:id/skills": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "skills", "view");
            const catalog = (await skills.ordered()).map(serializeNamed);
            const attached = (await position.skills()).map(serializeNamed);
            return renderPage(request, "skills/position", {
              position: serializePosition(position),
              catalog,
              attached,
            });
          },
        ),
      ),
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "skills", "update");
            const { fields } = await parseFormBody(request);
            const items = parseSkillIds(fields.skill_ids).map((skill_id) => ({ skill_id }));
            await skillService.replacePositionSkills(actor, position, items);
            return redirectResponse(`/positions/${position.id}/skills`);
          },
        ),
      ),
    },
    "/positions/:id/match": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "skills", "update");
            const matches = await skillService.matchCandidates(position);
            return renderPage(request, "skills/match", {
              position: serializePosition(position),
              matches: matches.map((row) => skillService.presentMatch(row)),
            });
          },
        ),
      ),
    },
    "/departments/:id/applications": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            await authorize(request, "skills", "view");
            const rows = await department.applications();
            return renderPage(request, "departments/applications", {
              department: serializeNamed(department),
              count: rows.length,
              applications: rows.map((row) => row.toArray()),
            });
          },
        ),
      ),
    },
  };
}
