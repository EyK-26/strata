import { join, relative, sep } from "node:path";
import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import { moduleDirectory, toKebabCase, toPascalCase } from "./utils";

async function makeFactoryCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:factory", args);
  if (!parsed) return;
  const [name] = parsed;
  if (!name) {
    throw new Error("make:factory requires a model name.");
  }

  const moduleSlug = toKebabCase(name);
  const modelName = toPascalCase(name);
  const directory = await moduleDirectory(moduleSlug);
  const filePath = join(directory, "factory.ts");

  const exists = await Bun.file(filePath).exists();
  if (exists) {
    throw new Error(`Factory already exists: ${filePath}`);
  }

  const recordImport = (await Bun.file(join(directory, "types.ts")).exists())
    ? "./types"
    : relative(
        directory,
        join(process.cwd(), "src", "models", ...name.split("/").map(toPascalCase)),
      )
        .split(sep)
        .join("/") + ".ts";
  const content = `import { createFactory, type FactoryPersist } from "@getstrata/core/database/factory";
import type { ${modelName}Record } from "${recordImport}";

function create${modelName}Factory(definition: () => ${modelName}Record, persist?: FactoryPersist<${modelName}Record>) {
  return createFactory({ definition, persist });
}

// Supply persistence from the current invocation, e.g. values => session.repository(${modelName}Repository).create(values).
export { create${modelName}Factory };
`;

  await writeScaffoldFile(relative(process.cwd(), filePath).split(sep), content, "Factory");
  console.log(`Created factory: ${filePath}`);
}

export { makeFactoryCommand };
