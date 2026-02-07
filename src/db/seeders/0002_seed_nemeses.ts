import type { Seeder } from "./types";

const seeder: Seeder = {
  name: "0002_seed_nemeses",
  async run(db) {
    await db`
      INSERT INTO nemesis (
        id,
        is_alive,
        years,
        character_id
      ) VALUES
        (1, TRUE, 120, 1),
        (2, FALSE, 0, 1),
        (3, TRUE, 220, 2)
      ON CONFLICT (id) DO NOTHING
    `;
  },
};

export default seeder;
