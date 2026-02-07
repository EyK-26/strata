import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureDirectory,
  moduleDirectory,
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from "./utils";

async function registerModuleInBootstrap(
  moduleSlug: string,
  moduleVariable: string,
): Promise<void> {
  const registryPath = join(
    import.meta.dir,
    "..",
    "..",
    "bootstrap",
    "modules.ts",
  );
  const importStatement = `import ${moduleVariable} from "../modules/${moduleSlug}/index.ts";`;
  const moduleEntry = `  ${moduleVariable},`;
  const currentContent = await Bun.file(registryPath).text();

  if (currentContent.includes(importStatement)) {
    return;
  }

  const withImport = currentContent.replace(
    'import type { AppModule } from "./contracts";',
    `import type { AppModule } from "./contracts";\n${importStatement}`,
  );

  if (withImport === currentContent) {
    throw new Error(
      "Could not register module import in src/bootstrap/modules.ts.",
    );
  }

  const listTerminator = "\n];";
  const listTerminatorIndex = withImport.lastIndexOf(listTerminator);

  if (listTerminatorIndex === -1) {
    throw new Error(
      "Could not register module entry in src/bootstrap/modules.ts.",
    );
  }

  const withEntry = `${withImport.slice(0, listTerminatorIndex)}\n${moduleEntry}${withImport.slice(listTerminatorIndex)}`;
  await Bun.write(registryPath, withEntry);
}

async function makeModuleCommand(name?: string): Promise<void> {
  if (!name) {
    throw new Error("make:module requires a name.");
  }

  const moduleSlug = toKebabCase(name);
  const moduleName = toPascalCase(name);
  const moduleIdentifier = toCamelCase(name);
  const moduleVariable = `${moduleIdentifier}Module`;

  if (!moduleName || !moduleIdentifier || !moduleSlug) {
    throw new Error("make:module requires a valid module name.");
  }

  const directory = moduleDirectory(moduleSlug);

  try {
    await access(directory);
    throw new Error(`Module already exists: ${directory}`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      if (
        error instanceof Error &&
        error.message.startsWith("Module already exists:")
      ) {
        throw error;
      }
      throw error;
    }
  }

  await ensureDirectory(directory);

  const pluralSlug = `${moduleSlug}s`;

  const files = new Map<string, string>([
    [
      "types.ts",
      `interface ${moduleName}Record {
  id: number;
}

export type { ${moduleName}Record };
`,
    ],
    [
      "table.ts",
      `import { defineTable } from "../../core/database";
import type { ${moduleName}Record } from "./types";

const ${moduleIdentifier}Table = defineTable<${moduleName}Record, "id">({
  name: "${moduleSlug}",
  primaryKey: "id",
  columns: ["id"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { ${moduleIdentifier}Table };
`,
    ],
    [
      "repository.ts",
      `import { BaseRepository } from "../../core/database";
import { ${moduleIdentifier}Table } from "./table";
import type { ${moduleName}Record } from "./types";

class ${moduleName}Repository extends BaseRepository<${moduleName}Record, "id"> {
  constructor() {
    super(${moduleIdentifier}Table);
  }
}

export default ${moduleName}Repository;
`,
    ],
    [
      "service.ts",
      `import ${moduleName}Repository from "./repository";

class ${moduleName}Service {
  constructor(private readonly repository: ${moduleName}Repository) {
    void this.repository;
  }
}

export default ${moduleName}Service;
`,
    ],
    [
      "provider.ts",
      `import type { ServiceProvider } from "../../bootstrap/contracts";
import ${moduleName}Repository from "./repository";
import ${moduleName}Service from "./service";

const ${moduleIdentifier}RepositoryToken = "${moduleSlug}.repository";
const ${moduleIdentifier}ServiceToken = "${moduleSlug}.service";

const ${moduleIdentifier}Provider: ServiceProvider = {
  name: "${moduleSlug}.provider",
  register({ container }) {
    container.singleton(${moduleIdentifier}RepositoryToken, () => new ${moduleName}Repository());
  },
  boot({ container }) {
    container.singleton(${moduleIdentifier}ServiceToken, () => {
      const repository = container.resolve<${moduleName}Repository>(${moduleIdentifier}RepositoryToken);
      return new ${moduleName}Service(repository);
    });
  },
};

export default ${moduleIdentifier}Provider;
export { ${moduleIdentifier}RepositoryToken, ${moduleIdentifier}ServiceToken };
`,
    ],
    [
      "requests.ts",
      `import { parsePositiveIntParam } from "../../core/http";

type ${moduleName}IdParams = { id: string };

function parse${moduleName}IdParams(params: ${moduleName}IdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "${moduleSlug} id"),
  };
}

export { parse${moduleName}IdParams };
export type { ${moduleName}IdParams };
`,
    ],
    [
      "resources.ts",
      `import { toResourceCollection } from "../../core/http";
import type { ${moduleName}Record } from "./types";

interface ${moduleName}Resource {
  id: number;
}

function to${moduleName}Resource(record: ${moduleName}Record): ${moduleName}Resource {
  return {
    id: record.id,
  };
}

function to${moduleName}ResourceCollection(
  records: readonly ${moduleName}Record[],
): ${moduleName}Resource[] {
  return toResourceCollection(records, to${moduleName}Resource);
}

export { to${moduleName}Resource, to${moduleName}ResourceCollection };
export type { ${moduleName}Resource };
`,
    ],
    [
      "controller.ts",
      `import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { jsonResponse, withErrorHandling } from "../../core/http";
import type ${moduleName}Repository from "./repository";
import { ${moduleIdentifier}RepositoryToken } from "./provider";
import { parse${moduleName}IdParams, type ${moduleName}IdParams } from "./requests";
import {
  to${moduleName}Resource,
  to${moduleName}ResourceCollection,
} from "./resources";

class ${moduleName}Controller {
  private readonly repository: ${moduleName}Repository;

  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {
    this.repository = dependencies.container.resolve<${moduleName}Repository>(
      ${moduleIdentifier}RepositoryToken,
    );
  }

  readonly index = withErrorHandling(async () => {
    return await this.cachedJson("/${pluralSlug}", async () => {
      return to${moduleName}ResourceCollection(await this.repository.findAll());
    });
  });

  readonly show = withErrorHandling(
    async ({ params }: { params: ${moduleName}IdParams }) => {
      const { id } = parse${moduleName}IdParams(params);
      const record = await this.repository.findByIdOrThrow(id);
      return jsonResponse(to${moduleName}Resource(record));
    },
  );
}

export default ${moduleName}Controller;
`,
    ],
    [
      "routes.ts",
      `import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import ${moduleName}Controller from "./controller";

function create${moduleName}Routes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
) {
  const controller = new ${moduleName}Controller(dependencies, cachedJson);

  return {
    "/${pluralSlug}": controller.index,
    "/${pluralSlug}/:id": controller.show,
  };
}

export { create${moduleName}Routes };
`,
    ],
    [
      "index.ts",
      `import { type AppModule } from "../../bootstrap/contracts";
import ${moduleName}Controller from "./controller";
import ${moduleIdentifier}Provider, {
  ${moduleIdentifier}RepositoryToken,
  ${moduleIdentifier}ServiceToken,
} from "./provider";
import { create${moduleName}Routes } from "./routes";

const ${moduleVariable}: AppModule = {
  name: "${moduleSlug}",
  providers: [${moduleIdentifier}Provider],
  routes({ dependencies, cachedJson }) {
    return create${moduleName}Routes(dependencies, cachedJson);
  },
};

export default ${moduleVariable};
export {
  ${moduleIdentifier}Provider,
  ${moduleIdentifier}RepositoryToken,
  ${moduleIdentifier}ServiceToken,
};
export { ${moduleName}Controller };
export { parse${moduleName}IdParams } from "./requests";
export { to${moduleName}Resource, to${moduleName}ResourceCollection } from "./resources";
export { create${moduleName}Routes } from "./routes";
export { default as ${moduleName}Repository } from "./repository";
export { default as ${moduleName}Service } from "./service";
export { ${moduleIdentifier}Table } from "./table";
export type { ${moduleName}Record } from "./types";
`,
    ],
  ]);

  for (const [fileName, content] of files) {
    await Bun.write(join(directory, fileName), content);
  }

  await registerModuleInBootstrap(moduleSlug, moduleVariable);

  console.log(`Created module scaffold in: ${directory}`);
  console.log(`Registered module in: src/bootstrap/modules.ts`);
}

export { makeModuleCommand };
