import type { Seeder } from "./types";

const seeder: Seeder = {
  name: "0001_seed_characters",
  async run(db) {
    await db`
      INSERT INTO "character" (
        id,
        name,
        gender,
        ability,
        minimal_distance,
        weight,
        born,
        in_space_since,
        beer_consumption,
        knows_the_answer
      ) VALUES
        (1, 'Arthur Dent', 'male', 'panic', '5m', 82, '2000-01-01', '2024-01-01', 3, FALSE),
        (2, 'Trillian Astra', 'female', 'astrophysics', '100m', 60, '1980-01-01', '2022-05-01', 1, TRUE)
      ON CONFLICT (id) DO NOTHING
    `;
  },
};

export default seeder;
