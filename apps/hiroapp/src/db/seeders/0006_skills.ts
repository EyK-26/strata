import type { Seeder } from "@getstrata/core/database/seeders/types";
import { Position } from "../../models/Position.ts";
import { Skill } from "../../models/Skill.ts";
import { User } from "../../models/User.ts";
import { positions } from "../../modules/positions/repository.ts";
import { skills } from "../../modules/skills/repository.ts";
import { users } from "../../modules/users/repository.ts";

const NAMES = ["TypeScript", "React", "PostgreSQL", "Communication", "Leadership"];

const seeder: Seeder = {
  name: "skills",
  async run() {
    for (const name of NAMES) {
      const existing = await skills.findByName(name);
      if (!existing) {
        await Skill.create({ name });
      }
    }

    const catalog = await skills.ordered();
    const typescript = catalog.find((row) => row.name === "TypeScript");
    const react = catalog.find((row) => row.name === "React");
    const postgres = catalog.find((row) => row.name === "PostgreSQL");
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    if (candidate && typescript && react) {
      const owner = User.newFromRecord(candidate);
      await owner.skills().detach();
      await owner.skills().withPivotValues({ years: 3, level: "advanced" }).attach(typescript.id);
      await owner.skills().withPivotValues({ years: 2, level: "intermediate" }).attach(react.id);
    }

    const hiring = await positions.hiring();
    const first = hiring[0];
    if (first && typescript && postgres) {
      const position = Position.newFromRecord(first);
      await position.skills().detach();
      await position.skills().withPivotValues({ required: true, weight: 3 }).attach(typescript.id);
      await position.skills().withPivotValues({ required: false, weight: 1 }).attach(postgres.id);
    }
  },
};

export default seeder;
