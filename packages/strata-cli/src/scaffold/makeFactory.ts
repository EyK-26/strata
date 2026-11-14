import { dirname, join, relative, sep } from "node:path";
import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import { moduleDirectory, toKebabCase, toPascalCase } from "./utils";

async function makeFactoryCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:factory", args);
  if (!parsed) return;
  const [name] = parsed;
  if (!name) {
    throw new Error("make:factory requires a model name.");
  }

  const classParts = name.split("/").map(toPascalCase);
  const modelName = classParts.join("");
  const filePath = join(
    process.cwd(),
    "src",
    "db",
    "factories",
    ...classParts.slice(0, -1),
    `${classParts.at(-1)}Factory.ts`,
  );
  if (await Bun.file(filePath).exists()) throw new Error(`Factory already exists: ${filePath}`);
  const standalone = join(process.cwd(), "src", "models", ...classParts) + ".ts";
  const module = await moduleDirectory(toKebabCase(name));
  const candidates = [standalone, join(module, "types.ts"), join(module, "model.ts")];
  let recordPath: string | undefined;
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      recordPath = candidate;
      break;
    }
  }
  if (!recordPath)
    throw new Error(
      `Model ${modelName} was not found. Create it with make:model or make:module before make:factory.`,
    );
  let recordImport = relative(dirname(filePath), recordPath).split(sep).join("/");
  if (!recordImport.startsWith(".")) recordImport = `./${recordImport}`;
  const content = `import { createFactory, type FactoryPersist } from "@getstrata/core/database/factory";
import type { ${modelName}Record } from "${recordImport}";

function create${modelName}Factory(definition: () => ${modelName}Record, persist?: FactoryPersist<${modelName}Record>) {
  return createFactory({ definition, persist });
}

// Supply persistence from the current invocation, e.g. async values => (await session.model(${modelName}Definition).create(values)).toObject().
export { create${modelName}Factory };
`;

  await writeScaffoldFile(relative(process.cwd(), filePath).split(sep), content, "Factory");
  console.log(`Created factory: ${filePath}`);
}

export { makeFactoryCommand };
