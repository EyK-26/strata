import type { Seeder } from "@getstrata/core/database/seeders/types";
import { seedScale } from "../../bootstrap/config.ts";
import { DEPARTMENTS, departmentFactory } from "../factories/departmentFactory.ts";

const seeder: Seeder = {
  name: "departments",
  async run() {
    const { departments } = seedScale();
    await departmentFactory
      .sequence(
        ...DEPARTMENTS.map((name) => ({
          name: `Department of ${name}`,
        })),
      )
      .count(departments)
      .create();
  },
};

export default seeder;
