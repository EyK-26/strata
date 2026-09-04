import { ConflictError, NotFoundError, ValidationError } from "@getstrata/core/errors/http";
import { positions } from "../positions/repository.ts";
import { departments } from "./repository.ts";
import type { DepartmentRecord } from "./table.ts";

function normalizeName(name: string) {
  return name.trim();
}

function missingDepartment(id: number) {
  return new NotFoundError(`Department ${id} not found.`);
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
    return departments.create({ name: trimmed });
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
