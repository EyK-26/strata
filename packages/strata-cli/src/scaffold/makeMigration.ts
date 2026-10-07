import { access } from "node:fs/promises";
import { join } from "node:path";
import { ensureDirectory, migrationDirectory, timestampForFilename, toKebabCase } from "./utils";

async function makeMigrationCommand(name?: string): Promise<void> {
  if (!name) {
    throw new Error("make:migration requires a name.");
  }

  const normalizedName = toKebabCase(name).replace(/-/g, "_");
  if (!normalizedName) {
    throw new Error("make:migration requires a valid migration name.");
  }

  const fileBaseName = `${timestampForFilename()}_${normalizedName}`;
  const directory = migrationDirectory();
  const filePath = join(directory, `${fileBaseName}.ts`);

  await ensureDirectory(directory);

  try {
    await access(filePath);
    throw new Error(`Migration already exists: ${filePath}`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      if (error instanceof Error && error.message.startsWith("Migration already exists:")) {
        throw error;
      }
      throw error;
    }
  }

  const content = `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema, resolveDatabaseDriver } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "${fileBaseName}",
  async up(db) {
    await Schema.run(db, resolveDatabaseDriver(), (schema) => {
      // Define schema.create(...) or schema.table(...) here.
      // Keep data transformations and unsupported engine features in db.unsafe(...).
      void schema;
    });
  },
  async down(db) {
    await Schema.run(db, resolveDatabaseDriver(), (schema) => {
      // Reverse the schema changes; guard against losing business history.
      void schema;
    });
  },
};

export default migration;
`;

  await Bun.write(filePath, content);
  console.log(`Created migration: ${filePath}`);
}

export { makeMigrationCommand };
