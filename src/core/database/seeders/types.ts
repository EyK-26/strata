interface SeederDatabase {
  unsafe(query: string): Promise<unknown>;
}

interface Seeder {
  name: string;
  run(db: SeederDatabase): Promise<void>;
}

export type { Seeder, SeederDatabase };
