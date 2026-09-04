import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { GRADE, isAdmin, isRecruiter, isStaff } from "../../lib/roles.ts";
import { hiringFlag } from "../../lib/serialize.ts";
import { resolveStaffDepartmentId } from "../../lib/staffTeam.ts";
import { Position } from "../../models/Position.ts";
import { applications } from "../applications/repository.ts";
import { departments } from "../departments/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { positions } from "./repository.ts";
import type { PositionRecord } from "./table.ts";

export type PositionCreateInput = {
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  pay_grade: number;
  department_id: number;
};

export type PositionUpdateInput = {
  name?: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  pay_grade?: number;
};

const GRADES = new Set<number>([GRADE.LOW, GRADE.MEDIUM, GRADE.HIGH]);

function missingPosition(id: number) {
  return new NotFoundError(`Position ${id} not found.`);
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage positions.");
  }
}

function normalizeName(name: string) {
  return name.trim();
}

function requireGrade(payGrade: number) {
  if (!GRADES.has(payGrade)) {
    throw new ValidationError("The given data was invalid.", {
      pay_grade: ["The pay grade is invalid."],
    });
  }
  return payGrade;
}

function parseOptionalDate(value: string | null | undefined, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("The given data was invalid.", {
      [field]: ["The date is invalid."],
    });
  }
  return date;
}

export function shouldCloseExpiredSeat(end: unknown, now: Date): boolean {
  if (!end) {
    return false;
  }
  const endDate = end instanceof Date ? end : new Date(String(end));
  if (Number.isNaN(endDate.getTime()) || endDate >= now) {
    return false;
  }
  return true;
}

async function departmentIdForCreate(actor: UserRecord, requested: number) {
  if (isRecruiter(actor.role_id)) {
    const teamId = await resolveStaffDepartmentId(actor);
    if (!teamId) {
      throw new ForbiddenError("Recruiter has no hiring team.");
    }
    return teamId;
  }
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new ValidationError("The given data was invalid.", {
      department_id: ["The department is required."],
    });
  }
  return requested;
}

export class PositionService {
  async listHiringForActor(
    user: UserRecord,
    filters: { search?: string; department_id?: number } = {},
  ) {
    const search = filters.search?.trim() || undefined;
    if (isRecruiter(user.role_id)) {
      const teamId = await resolveStaffDepartmentId(user);
      if (!teamId) {
        throw new ForbiddenError("Recruiter has no hiring team.");
      }
      return positions.hiring({ departmentId: teamId, search });
    }
    return positions.hiring({
      search,
      departmentId: filters.department_id || undefined,
    });
  }

  async create(actor: UserRecord, input: PositionCreateInput): Promise<PositionRecord> {
    assertStaff(actor);
    const name = normalizeName(input.name);
    if (!name) {
      throw new ValidationError("The given data was invalid.", {
        name: ["The name field is required."],
      });
    }
    const departmentId = await departmentIdForCreate(actor, input.department_id);
    const department = await departments.findById(departmentId);
    if (!department) {
      throw new UnprocessableEntityError("Department not found.");
    }
    const created = await positions.create({
      user_id: null,
      department_id: departmentId,
      grade_id: requireGrade(input.pay_grade),
      name,
      description: input.description?.trim() || null,
      hiring: true,
      start_date: parseOptionalDate(input.start_date, "start_date") ?? null,
      end_date: parseOptionalDate(input.end_date, "end_date") ?? null,
    });
    await recordHiringEvent(
      "position.opened",
      {
        position_id: created.id,
        department_id: departmentId,
        name,
        created_by: actor.id,
      },
      { type: "position", id: created.id },
    );
    return created;
  }

  async update(actor: UserRecord, position: Position, input: PositionUpdateInput) {
    assertStaff(actor);
    const changes: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = normalizeName(input.name);
      if (!name) {
        throw new ValidationError("The given data was invalid.", {
          name: ["The name field is required."],
        });
      }
      changes.name = name;
    }
    if (input.description !== undefined) {
      changes.description = input.description?.trim() || null;
    }
    if (input.pay_grade !== undefined) {
      changes.grade_id = requireGrade(input.pay_grade);
    }
    const start = parseOptionalDate(input.start_date, "start_date");
    if (start !== undefined) {
      changes.start_date = start;
    }
    const end = parseOptionalDate(input.end_date, "end_date");
    if (end !== undefined) {
      changes.end_date = end;
    }
    if (Object.keys(changes).length === 0) {
      return positions.findByIdOrThrow(Number(position.id), missingPosition);
    }
    const updated = await positions.updateByIdOrThrow(
      Number(position.id),
      changes,
      missingPosition,
    );
    await recordHiringEvent(
      "position.updated",
      { position_id: updated.id, changes, updated_by: actor.id },
      { type: "position", id: updated.id },
    );
    return updated;
  }

  async close(actor: UserRecord, position: Position) {
    assertStaff(actor);
    if (hiringFlag(position.get("hiring") as boolean | number | null) !== 1) {
      throw new ForbiddenError("Position is already closed.");
    }
    await position.update({ hiring: false });
    await recordHiringEvent(
      "position.closed",
      { position_id: Number(position.id), closed_by: actor.id },
      { type: "position", id: Number(position.id) },
    );
    return Position.findOrFail(Number(position.id));
  }

  async reopen(actor: UserRecord, position: Position) {
    assertStaff(actor);
    if (hiringFlag(position.get("hiring") as boolean | number | null) === 1) {
      throw new ForbiddenError("Position is already open.");
    }
    if (position.get("user_id")) {
      throw new ConflictError("Occupied positions cannot be reopened.");
    }
    await position.update({ hiring: true });
    await recordHiringEvent(
      "position.reopened",
      { position_id: Number(position.id), reopened_by: actor.id },
      { type: "position", id: Number(position.id) },
    );
    return Position.findOrFail(Number(position.id));
  }

  async remove(actor: UserRecord, position: Position) {
    if (!isAdmin(actor.role_id)) {
      throw new ForbiddenError("Only admins can delete positions.");
    }
    const id = Number(position.id);
    await applications.deleteForPosition(id);
    await position.delete();
    await recordHiringEvent(
      "position.deleted",
      { position_id: id, deleted_by: actor.id },
      { type: "position", id },
    );
    return { deleted: true, id };
  }

  async restore(actor: UserRecord, position: Position) {
    if (!isAdmin(actor.role_id)) {
      throw new ForbiddenError("Only admins can restore positions.");
    }
    await position.restore();
    await recordHiringEvent(
      "position.restored",
      { position_id: Number(position.id), restored_by: actor.id },
      { type: "position", id: Number(position.id) },
    );
    return Position.findOrFail(Number(position.id));
  }

  async closeExpired(now = new Date()) {
    const open = await Position.where({ hiring: true }).get();
    let closed = 0;
    for (const position of open) {
      if (!shouldCloseExpiredSeat(position.get("end_date"), now)) {
        continue;
      }
      await position.update({ hiring: false });
      await recordHiringEvent(
        "position.expired",
        { position_id: Number(position.id) },
        { type: "position", id: Number(position.id) },
      );
      closed += 1;
    }
    return closed;
  }
}

export const positionService = new PositionService();
