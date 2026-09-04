import type { Seeder } from "@getstrata/core/database/seeders/types";
import { rejectionReasons } from "../../modules/rejections/repository.ts";

const NAMES = ["skills", "experience", "culture", "compensation", "other"];

const seeder: Seeder = {
  name: "rejection_reasons",
  async run() {
    for (const name of NAMES) {
      const existing = await rejectionReasons.firstOrNull({ name });
      if (!existing) {
        await rejectionReasons.create({ name });
      }
    }
  },
};

export default seeder;
