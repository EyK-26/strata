interface MigrationDatabase {
  unsafe<T = unknown>(query: string, params?: readonly unknown[]): Promise<T[]>;
  schema?: import("../schema/schema.ts").SchemaBuilder;
}

/** Explicit destructive reset is distinct from an ordinary rollback. */
interface MigrationDownContext {
  operation: "fresh";
}

interface Migration {
  name: string;
  up(db: MigrationDatabase): Promise<void>;
  down(db: MigrationDatabase, context?: MigrationDownContext): Promise<void>;
}

type MigrationStatus = {
  name: string;
  status: "up" | "pending";
  batch: number | null;
};

export type { Migration, MigrationDatabase, MigrationDownContext, MigrationStatus };
