import { Schema } from "@getstrata/core/database/schema";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { type BoundDatabaseFixture, withBoundDatabase } from "./boundRepositoryHarness";

interface NestedMorphFixture extends BoundDatabaseFixture {
  readonly schema: Parameters<typeof Schema.run>[2];
}
function withNestedMorphDatabase<T>(
  fixture: NestedMorphFixture,
  work: (database: DatabaseSession) => T | Promise<T>,
): Promise<T> {
  return withBoundDatabase(fixture, async (database) => {
    await Schema.run(
      {
        unsafe: <Row>(text: string, params: readonly unknown[] = []) =>
          database.execute<Row>({ text, params }).then((rows) => [...rows]),
      },
      database.dialect.driver,
      fixture.schema,
    );
    return work(database);
  });
}

export { withNestedMorphDatabase };
