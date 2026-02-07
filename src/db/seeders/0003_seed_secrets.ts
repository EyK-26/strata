import type { Seeder } from "./types";

const seeder: Seeder = {
  name: "0003_seed_secrets",
  async run(db) {
    await db`
      INSERT INTO secret (
        id,
        secret_code,
        nemesis_id
      ) VALUES
        (1, 'DON''T PANIC', 1),
        (2, '42', 1),
        (3, 'HEART_OF_GOLD', 3)
      ON CONFLICT (id) DO NOTHING
    `;
  },
};

export default seeder;
