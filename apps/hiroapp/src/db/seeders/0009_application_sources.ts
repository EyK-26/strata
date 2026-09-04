import type { Seeder } from "@getstrata/core/database/seeders/types";
import { applicationSources } from "../../modules/sources/repository.ts";

const NAMES = ["linkedin", "referral", "career_site", "agency", "other"];

const seeder: Seeder = {
  name: "application_sources",
  async run() {
    for (const name of NAMES) {
      const existing = await applicationSources.firstOrNull({ name });
      if (!existing) {
        await applicationSources.create({ name });
      }
    }
  },
};

export default seeder;
