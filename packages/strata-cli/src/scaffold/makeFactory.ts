import { join } from "node:path";
import { ensureDirectory, moduleDirectory, toKebabCase, toPascalCase } from "./utils";

async function makeFactoryCommand(name?: string): Promise<void> {
  if (!name) {
    throw new Error("make:factory requires a model name.");
  }

  const moduleSlug = toKebabCase(name);
  const modelName = toPascalCase(name);
  const directory = moduleDirectory(moduleSlug);
  const filePath = join(directory, "factory.ts");

  await ensureDirectory(directory);

  const exists = await Bun.file(filePath).exists();
  if (exists) {
    throw new Error(`Factory already exists: ${filePath}`);
  }

  const content = `import { defineFactory, Factory, type FactoryPersist } from "@getstrata/core/database/factory";
import type { ${modelName}Record } from "./types";

export interface ${modelName}FactoryDependencies {
  definition: () => ${modelName}Record;
  persist?: FactoryPersist<${modelName}Record>;
}

const ${modelName}Factory = defineFactory<${modelName}Record, ${modelName}FactoryDependencies>({
  construct: dependencies => ({
    definition: () => dependencies.definition(),
    persist: values => {
      if (!dependencies.persist) throw new Error("${modelName}Factory persistence must be supplied to use create().");
      return dependencies.persist(values);
    },
  }),
});

function create${modelName}Factory(dependencies: ${modelName}FactoryDependencies) {
  return Factory.from(${modelName}Factory, dependencies);
}

export { ${modelName}Factory, create${modelName}Factory };
`;

  await Bun.write(filePath, content);
  console.log(`Created factory: ${filePath}`);
}

export { makeFactoryCommand };
