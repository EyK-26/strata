import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isAdmin } from "../../lib/roles.ts";
import { hiringFlag, serializeNamed } from "../../lib/serialize.ts";
import { positions } from "../positions/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { departments } from "./repository.ts";
import type { DepartmentRecord } from "./table.ts";

function normalizeName(name: string) {
  return name.trim();
}

function missingDepartment(id: number) {
  return new NotFoundError(`Department ${id} not found.`);
}

function isFrozen(row: DepartmentRecord) {
  return hiringFlag(row.hiring_frozen) === 1;
}

export function serializeDepartment(row: DepartmentRecord) {
  return {
    ...serializeNamed(row),
    hiring_frozen: isFrozen(row),
  };
}

export class DepartmentService {
  async ordered() {
    return departments.ordered();
  }

  async create(name: string): Promise<DepartmentRecord> {
    const trimmed = normalizeName(name);
    if (!trimmed) {
      throw new ValidationError("The given data was invalid.", {
        name: ["The name field is required."],
      });
    }
    const existing = await departments.findByName(trimmed);
    if (existing) {
      throw new ConflictError("A department with that name already exists.");
    }
    return departments.create({ name: trimmed, hiring_frozen: false });
  }

  async assertHiringOpen(departmentId: number) {
    const department = await departments.findById(departmentId);
    if (!department) {
      throw missingDepartment(departmentId);
    }
    if (isFrozen(department)) {
      throw new UnprocessableEntityError("Hiring is frozen for this department.");
    }
    return department;
  }

  async freeze(actor: UserRecord, departmentId: number) {
    if (!isAdmin(actor.role_id)) {
      throw new ForbiddenError("Only admins can freeze hiring.");
    }
    const department = await departments.findByIdOrThrow(departmentId, missingDepartment);
    if (isFrozen(department)) {
      throw new ConflictError("Hiring is already frozen for this department.");
    }
    const updated = await departments.updateByIdOrThrow(departmentId, { hiring_frozen: true });
    await recordHiringEvent(
      "department.frozen",
      { department_id: updated.id, frozen_by: actor.id },
      { type: "department", id: updated.id },
    );
    return updated;
  }

  async unfreeze(actor: UserRecord, departmentId: number) {
    if (!isAdmin(actor.role_id)) {
      throw new ForbiddenError("Only admins can unfreeze hiring.");
    }
    const department = await departments.findByIdOrThrow(departmentId, missingDepartment);
    if (!isFrozen(department)) {
      throw new ForbiddenError("Hiring is not frozen for this department.");
    }
    const updated = await departments.updateByIdOrThrow(departmentId, { hiring_frozen: false });
    await recordHiringEvent(
      "department.unfrozen",
      { department_id: updated.id, unfrozen_by: actor.id },
      { type: "department", id: updated.id },
    );
    return updated;
  }

  async rename(id: number, name: string): Promise<DepartmentRecord> {
    const department = await departments.findByIdOrThrow(id, missingDepartment);
    const trimmed = normalizeName(name);
    if (!trimmed) {
      throw new ValidationError("The given data was invalid.", {
        name: ["The name field is required."],
      });
    }
    const existing = await departments.findByName(trimmed);
    if (existing && Number(existing.id) !== Number(department.id)) {
      throw new ConflictError("A department with that name already exists.");
    }
    return departments.updateByIdOrThrow(id, { name: trimmed });
  }

  async remove(id: number) {
    await departments.findByIdOrThrow(id, missingDepartment);
    const seats = await positions.idsInDepartment(id);
    if (seats.length > 0) {
      throw new ConflictError("Department still has positions.");
    }
    await departments.deleteById(id);
    return { deleted: true, id };
  }
}

export const departmentService = new DepartmentService();
