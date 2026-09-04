import { faker } from "@faker-js/faker";
import { Factory } from "@getstrata/core/database/factory";
import { Department } from "../../models/Department.ts";
import type { DepartmentRecord } from "../../modules/departments/repository.ts";

const DEPARTMENTS = [
  "Engineering",
  "People",
  "Finance",
  "Marketing",
  "Sales",
  "Operations",
  "Legal",
  "Product",
  "Support",
  "Design",
  "Security",
  "Data",
  "Research",
  "Facilities",
  "Communications",
  "Quality",
  "Procurement",
  "Training",
  "Strategy",
  "Customer Success",
];

export class DepartmentFactory extends Factory<DepartmentRecord> {
  protected model = Department;

  protected definition(): DepartmentRecord {
    return {
      id: 0,
      name: `Department of ${faker.helpers.arrayElement(DEPARTMENTS)} ${faker.string.alphanumeric(4)}`,
      created_at: null,
      updated_at: null,
    };
  }
}

export const departmentFactory = new DepartmentFactory();
export { DEPARTMENTS };
