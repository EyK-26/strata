import type { Seeder } from "@getstrata/core/database/seeders/types";
import { seedScale } from "../../bootstrap/config.ts";
import { ROLE } from "../../lib/roles.ts";
import { departments } from "../../modules/departments/repository.ts";
import { users } from "../../modules/users/repository.ts";
import { positionFactory } from "../factories/positionFactory.ts";

const seeder: Seeder = {
  name: "positions",
  async run() {
    const { positions: count } = seedScale();
    const deptRows = await departments.ordered();
    const recruiter = await users.findByEmail("recruiter@hiroapp.com");
    const admin = await users.findByEmail("admin@hiroapp.com");
    const reserved = new Set([recruiter?.id, admin?.id].filter((id): id is number => Boolean(id)));
    const staff = (
      await users.findWherePublic({ role_id: { in: [ROLE.ADMIN, ROLE.RECRUITER] } })
    ).filter((user) => !reserved.has(user.id));

    for (let index = 0; index < count; index += 1) {
      const department = deptRows[index % deptRows.length];
      const occupant = index < staff.length && index % 3 === 0 ? staff[index] : null;
      await positionFactory.create({
        department_id: department?.id ?? 1,
        user_id: occupant?.id ?? null,
        hiring: index % 2 === 0,
      });
    }

    const { positions } = await import("../../modules/positions/repository.ts");
    const firstDept = deptRows[0];
    if (recruiter && firstDept) {
      const open = await positions.hiring({ departmentId: firstDept.id });
      const seat = open[0] ?? (await positions.findAll({ limit: 1 }))[0];
      if (seat) {
        await positions.updateById(seat.id, {
          user_id: recruiter.id,
          department_id: firstDept.id,
        });
      }
    }
    if (admin) {
      const unused = (await positions.findAll()).find((row) => row.user_id === null);
      if (unused) {
        await positions.updateById(unused.id, { user_id: admin.id });
      }
    }
  },
};

export default seeder;
