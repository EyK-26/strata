import { ForbiddenError } from "@getstrata/core/errors/http";
import { User } from "../models/User.ts";
import { departments } from "../modules/departments/repository.ts";
import { departmentMembers } from "../modules/teams/memberRepository.ts";
import type { UserRecord } from "../modules/users/table.ts";
import { isAdmin, isStaff } from "./roles.ts";

export async function membershipsFor(userId: number) {
  return departmentMembers.forUser(userId);
}

export async function isDepartmentMember(userId: number, departmentId: number) {
  return Boolean(await departmentMembers.findMembership(departmentId, userId));
}

export async function resolveStaffDepartmentId(user: UserRecord): Promise<number | null> {
  const memberships = await departmentMembers.forUser(user.id);
  const ids = memberships.map((row) => Number(row.department_id));
  const current = user.current_department_id ? Number(user.current_department_id) : null;
  if (current && ids.includes(current)) {
    return current;
  }
  if (ids[0]) {
    return ids[0];
  }
  const seat = await User.newFromRecord(user).position().first();
  return seat ? Number(seat.get("department_id")) : null;
}

export async function requireStaffDepartmentAccess(user: UserRecord, departmentId: number) {
  if (!isStaff(user.role_id)) {
    throw new ForbiddenError("Staff only.");
  }
  if (isAdmin(user.role_id)) {
    const department = await departments.findById(departmentId);
    if (!department) {
      throw new ForbiddenError("Department not found.");
    }
    return;
  }
  if (!(await isDepartmentMember(user.id, departmentId))) {
    throw new ForbiddenError("You are not a member of this hiring team.");
  }
}

export async function canManageTeam(user: UserRecord, departmentId: number) {
  if (isAdmin(user.role_id)) {
    return true;
  }
  const membership = await departmentMembers.findMembership(departmentId, user.id);
  return membership?.role === "owner";
}
