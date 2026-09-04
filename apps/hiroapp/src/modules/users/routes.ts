import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { hashPassword } from "@getstrata/core/auth/password";
import { NotFoundError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { authorize } from "../../http/currentUser.ts";
import { UserResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { loadUserDetail } from "../../lib/loaders.ts";
import { serializeNamed } from "../../lib/serialize.ts";
import type { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { positions } from "../positions/repository.ts";
import { users } from "./repository.ts";
import { CreateUserRequest, UserIndexRequest } from "./requests.ts";

async function uniqueEmail(firstName: string, lastName: string) {
  const base = `${firstName}.${lastName}`.toLowerCase().replace(/\s+/g, "");
  const requested = `${base}@hiroapp.com`;
  const existing = await users.findByEmail(requested);
  if (!existing) {
    return requested;
  }
  const count = await users.countByEmailPrefix(`${base}`);
  return `${base}${count}@hiroapp.com`;
}

export function userRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/users": {
      GET: wrapApi(dependencies, async (request) => {
        await authorize(request, "users", "view");
        const query = new UserIndexRequest().validate(request);
        const occupantIds =
          query.department !== 0 ? await positions.occupiedUserIds(query.department) : undefined;
        const rows = await users.search(query.search, occupantIds);
        const details = await Promise.all(
          rows.map(async (user) => {
            const model = User.newFromRecord(user);
            await model.load("position");
            const position = model.loaded<Position>("position");
            if (position) {
              await position.load("department");
            }
            const department = position?.loaded<{
              id: number;
              name: string;
              created_at: Date | null;
              updated_at: Date | null;
            }>("department");
            return {
              ...new UserResource(user).toArray(),
              position: position
                ? {
                    id: position.id,
                    name: position.get("name"),
                    department: department
                      ? serializeNamed(department as { id: number; name: string })
                      : null,
                  }
                : null,
            };
          }),
        );
        return jsonResponse(details);
      }),
      POST: wrapApi(dependencies, async (request) => {
        await authorize(request, "users", "create");
        const payload = await new CreateUserRequest().validate(request);
        const position = await positions.findById(payload.position_id);
        if (!position) {
          throw new NotFoundError("Position not found.");
        }
        const email = await uniqueEmail(payload.first_name, payload.last_name);
        const user = await users.create({
          first_name: payload.first_name,
          last_name: payload.last_name,
          email,
          password: await hashPassword("password"),
          role_id: payload.role_id,
        });
        await positions.updateById(position.id, { user_id: user.id });
        return jsonResponse({ message: "success", id: user.id });
      }),
    },
    "/api/users/:id": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => User.findOrFail(id),
          async (request, user) => {
            await authorize(request, "users", "view");
            return jsonResponse(await loadUserDetail(Number(user.id)));
          },
        ),
      ),
    },
    "/api/users/:id/delete": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => User.findOrFail(id),
          async (request, target) => {
            await authorize(request, "users", "delete");
            const seat = await target.position().first();
            if (seat) {
              await seat.update({ user_id: null });
            }
            await users.deleteById(Number(target.id));
            return jsonResponse({ message: "User has been deleted" });
          },
        ),
      ),
    },
  };
}
