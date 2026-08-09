import type { SQL } from "bun";

interface Migration {
  name: string;
  up(db: SQL): Promise<void>;
  down(db: SQL): Promise<void>;
}

export type { Migration };
