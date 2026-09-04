import { faker } from "@faker-js/faker";
import { Factory } from "@getstrata/core/database/factory";
import { GRADE } from "../../lib/roles.ts";
import { Position } from "../../models/Position.ts";
import type { PositionRecord } from "../../modules/positions/repository.ts";

const TITLES = [
  "Software Engineer",
  "Product Manager",
  "Recruiter",
  "Designer",
  "Data Analyst",
  "Office Manager",
  "Accountant",
  "Sales Associate",
];

export class PositionFactory extends Factory<PositionRecord> {
  protected model = Position;

  protected definition(): PositionRecord {
    return {
      id: 0,
      user_id: null,
      department_id: 1,
      grade_id: faker.helpers.arrayElement([GRADE.LOW, GRADE.MEDIUM, GRADE.HIGH]),
      name: faker.helpers.arrayElement(TITLES),
      description: faker.lorem.paragraph(),
      hiring: faker.datatype.boolean(0.45),
      start_date: null,
      end_date: null,
      created_at: null,
      updated_at: null,
      deleted_at: null,
    };
  }
}

export const positionFactory = new PositionFactory();
