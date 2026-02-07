import seedCharacters from "./0001_seed_characters";
import seedNemeses from "./0002_seed_nemeses";
import seedSecrets from "./0003_seed_secrets";
import type { Seeder } from "./types";

const seeders: Seeder[] = [seedCharacters, seedNemeses, seedSecrets];

export { seeders };
export type { Seeder };
