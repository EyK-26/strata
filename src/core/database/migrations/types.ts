interface MigrationDatabase {
  unsafe<T = unknown>(query: string, params?: readonly unknown[]): Promise<T[]>;
  schema?: import("../schema/schema.ts").SchemaBuilder;
}

interface Migration {
  name: string;
  up(db: MigrationDatabase): Promise<void>;
  down(db: MigrationDatabase): Promise<void>;
}

type MigrationStatus = {
  name: string;
  status: "up" | "pending";
  batch: number | null;
};

export type { Migration, MigrationDatabase, MigrationStatus };
