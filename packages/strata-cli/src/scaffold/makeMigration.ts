import { access } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import { migrationDirectory, timestampForFilename, toKebabCase } from "./utils";

async function makeMigrationCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:migration", args);
  if (!parsed) return;
  const [name] = parsed;
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

  const content = `import { defineMigration } from "@getstrata/core/database/migrations";

export default defineMigration({
  name: "${fileBaseName}",
  up(schema, db) {
    // Define schema.create(...) or schema.table(...) here.
    // Use db.unsafe(...) for explicit data transformations.
    void schema;
    void db;
  },
  down(schema, db) {
    // Reverse the schema changes; preserve business history.
    void schema;
    void db;
  },
});
`;

  await writeScaffoldFile(relative(process.cwd(), filePath).split(sep), content, "Migration");
  console.log(`Created migration: ${filePath}`);
}

export { makeMigrationCommand };
