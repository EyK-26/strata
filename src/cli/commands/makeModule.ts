import { access } from "node:fs/promises";
import { join } from "node:path";
import { ensureDirectory, moduleDirectory, toCamelCase, toKebabCase, toPascalCase } from "./utils";

async function makeModuleCommand(...args: string[]): Promise<void> {
  const withWeb = args.includes("--with-web");
  const name = args.find((arg) => !arg.startsWith("--"));

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
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      if (error instanceof Error && error.message.startsWith("Module already exists:")) {
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
  name: string;
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
  columns: ["id", "name"],
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
import type { ${moduleName}Record } from "./types";
import type { PaginatedResult } from "../../core/pagination";

class ${moduleName}Service {
  constructor(private readonly repository: ${moduleName}Repository) {}

  paginate(options: {
    page: number;
    perPage: number;
  }): Promise<PaginatedResult<${moduleName}Record>> {
    return this.repository.paginate(options);
  }

  findByIdOrThrow(id: number): Promise<${moduleName}Record> {
    return this.repository.findByIdOrThrow(id);
  }

  create(input: { name: string }): Promise<${moduleName}Record> {
    return this.repository.create(input);
  }

  update(id: number, input: { name?: string }): Promise<${moduleName}Record> {
    return this.repository.update(id, input);
  }

  delete(id: number): Promise<void> {
    return this.repository.delete(id);
  }
}

export default ${moduleName}Service;
`,
    ],
    [
      "policy.ts",
      `import type { AuthUser } from "../../core/auth/authContext";
import { Policy } from "../../core/auth/policy";
import type { ${moduleName}Record } from "./types";

class ${moduleName}Policy extends Policy {
  override create(_user: AuthUser | null): boolean {
    return true;
  }

  override update(_user: AuthUser | null, _resource: ${moduleName}Record): boolean {
    return true;
  }

  override delete(user: AuthUser | null, _resource: ${moduleName}Record): boolean {
    return user?.role === "admin" || user?.role === "member";
  }
}

export default ${moduleName}Policy;
`,
    ],
    [
      "provider.ts",
      `import type { ServiceProvider } from "../../bootstrap/contracts";
import { CORE_POLICY_GATE_TOKEN } from "../../bootstrap/config";
import ${moduleName}Repository from "./repository";
import ${moduleName}Service from "./service";
import ${moduleName}Policy from "./policy";

const ${moduleIdentifier}RepositoryToken = "${moduleSlug}.repository";
const ${moduleIdentifier}ServiceToken = "${moduleSlug}.service";
const ${moduleIdentifier}PolicyToken = "${moduleSlug}.policy";

const ${moduleIdentifier}Provider: ServiceProvider = {
  name: "${moduleSlug}.provider",
  register({ container }) {
    container.singleton(${moduleIdentifier}RepositoryToken, () => new ${moduleName}Repository());
    container.singleton(${moduleIdentifier}PolicyToken, () => new ${moduleName}Policy());
  },
  boot({ container }) {
    container.singleton(${moduleIdentifier}ServiceToken, () => {
      const repository = container.resolve<${moduleName}Repository>(${moduleIdentifier}RepositoryToken);
      return new ${moduleName}Service(repository);
    });

    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("${moduleSlug}", container.resolve(${moduleIdentifier}PolicyToken));
  },
};

export default ${moduleIdentifier}Provider;
export {
  ${moduleIdentifier}PolicyToken,
  ${moduleIdentifier}RepositoryToken,
  ${moduleIdentifier}ServiceToken,
};
`,
    ],
    [
      "requests.ts",
      `import {
  parseJsonBody,
  parsePaginationQuery,
  parsePositiveIntParam,
} from "../../core/http";
import {
  maxLength,
  minLength,
  required,
  stringRule,
  validateObject,
} from "../../core/validation/rules";

type ${moduleName}IdParams = { id: string };

interface ${moduleName}ListQueryDto {
  page: number;
  perPage: number;
}

interface Create${moduleName}BodyDto {
  name: string;
}

interface Update${moduleName}BodyDto {
  name?: string;
}

function parse${moduleName}IdParams(params: ${moduleName}IdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "${moduleSlug} id"),
  };
}

function parse${moduleName}ListQuery(request?: Request): ${moduleName}ListQueryDto {
  return parsePaginationQuery(request);
}

async function parseCreate${moduleName}Body(
  request: Request,
): Promise<Create${moduleName}BodyDto> {
  return await parseJsonBody(request, (payload) => {
    const body = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
    });

    return {
      name: body.name as string,
    };
  });
}

async function parseUpdate${moduleName}Body(
  request: Request,
): Promise<Update${moduleName}BodyDto> {
  return await parseJsonBody(request, (payload) => {
    const body = validateObject(payload, {
      name: [stringRule(), minLength(1), maxLength(120)],
    });

    return {
      ...(body.name === undefined ? {} : { name: body.name as string }),
    };
  });
}

export {
  parseCreate${moduleName}Body,
  parse${moduleName}IdParams,
  parse${moduleName}ListQuery,
  parseUpdate${moduleName}Body,
};
export type {
  Create${moduleName}BodyDto,
  ${moduleName}IdParams,
  ${moduleName}ListQueryDto,
  Update${moduleName}BodyDto,
};
`,
    ],
    [
      "resources.ts",
      `import {
  toPaginatedResourceCollection,
  toResourceCollection,
} from "../../core/http";
import type { PaginationMeta } from "../../core/pagination";
import type { ${moduleName}Record } from "./types";

interface ${moduleName}Resource {
  id: number;
  name: string;
}

function to${moduleName}Resource(record: ${moduleName}Record): ${moduleName}Resource {
  return {
    id: record.id,
    name: record.name,
  };
}

function to${moduleName}ResourceCollection(
  records: readonly ${moduleName}Record[],
): ${moduleName}Resource[] {
  return toResourceCollection(records, to${moduleName}Resource);
}

function to${moduleName}PaginatedResourceCollection(
  records: readonly ${moduleName}Record[],
  meta: PaginationMeta,
) {
  return toPaginatedResourceCollection(records, meta, to${moduleName}Resource);
}

export {
  to${moduleName}PaginatedResourceCollection,
  to${moduleName}Resource,
  to${moduleName}ResourceCollection,
};
export type { ${moduleName}Resource };
`,
    ],
    [
      "controller.ts",
      `import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import {
  bindRouteModel,
  buildRequestCacheKey,
  createdResponse,
  jsonResponse,
  noContentResponse,
  securedBindRouteModel,
  type RouteRequest,
  withErrorHandling,
} from "../../core/http";
import ${moduleName}Service from "./service";
import { ${moduleIdentifier}ServiceToken } from "./provider";
import {
  parseCreate${moduleName}Body,
  parse${moduleName}ListQuery,
  parseUpdate${moduleName}Body,
  type ${moduleName}IdParams,
} from "./requests";
import {
  to${moduleName}PaginatedResourceCollection,
  to${moduleName}Resource,
} from "./resources";

const ${moduleIdentifier.toUpperCase()}_CACHE_TAG = "${pluralSlug}";

class ${moduleName}Controller {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  private get service(): ${moduleName}Service {
    return resolveService(this.dependencies, ${moduleIdentifier}ServiceToken);
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parse${moduleName}ListQuery(request);
    const cacheKey = buildRequestCacheKey("/${pluralSlug}", request);

    return await this.cachedJson(
      cacheKey,
      async () => {
        const result = await this.service.paginate(query);
        return to${moduleName}PaginatedResourceCollection(result.data, result.meta);
      },
      [${moduleIdentifier.toUpperCase()}_CACHE_TAG],
      request,
    );
  });

  readonly show = withErrorHandling(
    bindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      async (_request, record) => {
        return jsonResponse(to${moduleName}Resource(record));
      },
    ),
  );

  readonly store = withErrorHandling(async (request: Request) => {
    const body = await parseCreate${moduleName}Body(request);
    const record = await this.service.create(body);
    return createdResponse(to${moduleName}Resource(record));
  });

  readonly update = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "${moduleSlug}", action: "update" },
      async (req: RouteRequest<${moduleName}IdParams>, record) => {
        const body = await parseUpdate${moduleName}Body(req);
        const updated = await this.service.update(record.id, body);
        return jsonResponse(to${moduleName}Resource(updated));
      },
    ),
  );

  readonly destroy = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "${moduleSlug}", action: "delete" },
      async (_request, record) => {
        await this.service.delete(record.id);
        return noContentResponse();
      },
    ),
  );
}

export default ${moduleName}Controller;
`,
    ],
    [
      "routes.ts",
      `import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
import ${moduleName}Controller from "./controller";

function create${moduleName}Routes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new ${moduleName}Controller(dependencies, cachedJson);

  return {
    "/${pluralSlug}": {
      GET: controller.index,
      POST: kernel.wrapAbility(
        "${pluralSlug}:create",
        controller.store as unknown as RouteHandler,
      ),
    },
    "/${pluralSlug}/:id": {
      GET: controller.show,
      PATCH: kernel.wrapAbility(
        "${pluralSlug}:update",
        controller.update as unknown as RouteHandler,
      ),
      DELETE: kernel.wrapAbility(
        "${pluralSlug}:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
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
import { create${moduleName}Routes } from "./routes";${
        withWeb
          ? `
import { create${moduleName}WebRoutes } from "./webRoutes";`
          : ""
      }
import { ${moduleIdentifier}Table } from "./table";

const ${moduleVariable}: AppModule = {
  name: "${moduleSlug}",
  order: 100,
  tableName: ${moduleIdentifier}Table.name,
  cacheTags: ["${pluralSlug}"],
  providers: [${moduleIdentifier}Provider],
  // Optional: gate routes with isFeatureEnabled("yourFlag") from ../../config/features
  routes({ dependencies, cachedJson, kernel }) {
    return create${moduleName}Routes(dependencies, cachedJson, kernel);
  },${
    withWeb
      ? `
  webRoutes({ dependencies, kernel }) {
    return create${moduleName}WebRoutes(dependencies, kernel);
  },`
      : ""
  }
};

export default ${moduleVariable};
export {
  ${moduleIdentifier}Provider,
  ${moduleIdentifier}RepositoryToken,
  ${moduleIdentifier}ServiceToken,
};
export { ${moduleName}Controller };
export { parse${moduleName}IdParams, parse${moduleName}ListQuery } from "./requests";
export {
  to${moduleName}PaginatedResourceCollection,
  to${moduleName}Resource,
  to${moduleName}ResourceCollection,
} from "./resources";
export { create${moduleName}Routes } from "./routes";${
        withWeb
          ? `
export { create${moduleName}WebRoutes } from "./webRoutes";`
          : ""
      }
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

  if (withWeb) {
    const viewsDirectory = join(process.cwd(), "resources/views", pluralSlug);
    await ensureDirectory(viewsDirectory);
    await Bun.write(
      join(viewsDirectory, "index.eta"),
      `<section class="page-header">
  <h1>${moduleName}s</h1>
</section>

<p class="hint">Generated web view for ${pluralSlug}. Wire up ${moduleName}WebController next.</p>
`,
    );

    await Bun.write(
      join(directory, "webController.ts"),
      `import type { AppDependencies } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { CORE_VIEW_TOKEN } from "../../bootstrap/providers/view";
import { withErrorHandling } from "../../core/http";
import type { ViewEngine } from "../../core/view";
import { htmlResponse } from "../../core/view";
import { ${moduleIdentifier}ServiceToken } from "./provider";
import { parse${moduleName}ListQuery } from "./requests";
import type ${moduleName}Service from "./service";

class ${moduleName}WebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): ${moduleName}Service {
    return resolveService(this.dependencies, ${moduleIdentifier}ServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parse${moduleName}ListQuery(request);
    const result = await this.service.paginate(query);

    return htmlResponse(
      await this.view.render("${pluralSlug}/index", {
        title: "${moduleName}s",
        records: result.data,
        meta: result.meta,
      }),
    );
  });
}

export default ${moduleName}WebController;
`,
    );

    await Bun.write(
      join(directory, "webRoutes.ts"),
      `import type { AppDependencies } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { RouteHandler } from "../../core/http/middleware";
import ${moduleName}WebController from "./webController";

function create${moduleName}WebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new ${moduleName}WebController(dependencies);

  return {
    "/${pluralSlug}": {
      GET: kernel.wrapWebPublicRead(controller.index as unknown as RouteHandler),
    },
  };
}

export { create${moduleName}WebRoutes };
`,
    );
  }

  console.log(`Created module scaffold in: ${directory}`);
  if (withWeb) {
    console.log(`Created web view scaffold in: resources/views/${pluralSlug}/`);
  }
  console.log(`Module will be auto-discovered from src/modules/${moduleSlug}/`);
  console.log(`Next: bun run cli make:migration create_${moduleSlug} && bun run cli migrate`);
}

export { makeModuleCommand };
