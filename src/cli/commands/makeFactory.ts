import { join } from "node:path";
import { ensureDirectory, moduleDirectory, toCamelCase, toKebabCase, toPascalCase } from "./utils";

async function makeFactoryCommand(name?: string): Promise<void> {
  if (!name) {
    throw new Error("make:factory requires a model name.");
  }

  const moduleSlug = toKebabCase(name);
  const modelName = toPascalCase(name);
  const moduleIdentifier = toCamelCase(name);
  const directory = moduleDirectory(moduleSlug);
  const filePath = join(directory, "factory.ts");

  await ensureDirectory(directory);

  const exists = await Bun.file(filePath).exists();
  if (exists) {
    throw new Error(`Factory already exists: ${filePath}`);
  }

  const content = `import { Factory } from "../../core/database/factory";
import type { ${modelName}Record } from "./types";

class ${modelName}Factory extends Factory<${modelName}Record> {
  protected definition(): ${modelName}Record {
    const now = new Date();

    return {
      id: 0,
    } satisfies Partial<${modelName}Record> as ${modelName}Record;
  }

  protected persist(values: Partial<${modelName}Record>): Promise<${modelName}Record> {
    throw new Error("${modelName}Factory.persist() is not implemented.");
  }
}

const ${moduleIdentifier}Factory = new ${modelName}Factory();

export { ${modelName}Factory, ${moduleIdentifier}Factory };
`;

  await Bun.write(filePath, content);
  console.log(`Created factory: ${filePath}`);
}

export { makeFactoryCommand };
