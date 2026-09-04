import type { Seeder } from "@getstrata/core/database/seeders/types";
import { ROLE } from "../../lib/roles.ts";
import { departments } from "../../modules/departments/repository.ts";
import { departmentMembers } from "../../modules/teams/memberRepository.ts";
import { users } from "../../modules/users/repository.ts";

const seeder: Seeder = {
  name: "department_members",
  async run() {
    const deptRows = await departments.ordered();
    const first = deptRows[0];
    if (!first) {
      return;
    }
    const admin = await users.findByEmail("admin@hiroapp.com");
    const recruiter = await users.findByEmail("recruiter@hiroapp.com");
    if (admin) {
      await departmentMembers.create({
        department_id: first.id,
        user_id: admin.id,
        role: "owner",
        created_at: new Date(),
      });
      await users.updateById(admin.id, { current_department_id: first.id });
    }
    if (recruiter) {
      await departmentMembers.create({
        department_id: first.id,
        user_id: recruiter.id,
        role: "member",
        created_at: new Date(),
      });
      await users.updateById(recruiter.id, { current_department_id: first.id });
    }
    const extraStaff = await users.findWherePublic({
      role_id: { in: [ROLE.ADMIN, ROLE.RECRUITER] },
    });
    for (const [index, staff] of extraStaff.entries()) {
      if (staff.email === "admin@hiroapp.com" || staff.email === "recruiter@hiroapp.com") {
        continue;
      }
      const department = deptRows[index % deptRows.length] ?? first;
      const existing = await departmentMembers.findMembership(department.id, staff.id);
      if (existing) {
        continue;
      }
      await departmentMembers.create({
        department_id: department.id,
        user_id: staff.id,
        role: "member",
        created_at: new Date(),
      });
      if (!staff.current_department_id) {
        await users.updateById(staff.id, { current_department_id: department.id });
      }
    }
  },
};

export default seeder;
