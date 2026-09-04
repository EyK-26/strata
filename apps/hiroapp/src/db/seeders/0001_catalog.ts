import type { Seeder } from "@getstrata/core/database/seeders/types";
import { grades, roles, statuses } from "../../modules/catalog/repository.ts";

const seeder: Seeder = {
  name: "catalog",
  async run() {
    for (const name of ["admin", "candidate", "recruiter"]) {
      await roles.create({ name });
    }
    for (const name of ["low", "medium", "high"]) {
      await grades.create({ name });
    }
    for (const name of ["applied", "in progress", "interview", "feedback", "hired", "ended"]) {
      await statuses.create({ name });
    }
  },
};

export default seeder;
