import type { SQL } from "bun";

interface Seeder {
  name: string;
  run(db: SQL): Promise<void>;
}

export type { Seeder };
