type ModuleRenderOptions = {
  moduleSlug: string;
  moduleName: string;
  moduleIdentifier: string;
  withWeb: boolean;
};

/** Render module sources without consulting or changing the application filesystem. */
function renderModuleScaffold({
  moduleSlug,
  moduleName,
  moduleIdentifier,
  withWeb,
}: ModuleRenderOptions) {
  const moduleVariable = `${moduleIdentifier}Module`;
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
      `import { defineTable } from "@getstrata/core/database/table";
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
      `import { BaseRepository } from "@getstrata/core/database/baseRepository";
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
      `import { NotFoundError } from "@getstrata/core/errors/http";
import ${moduleName}Repository from "./repository";
import type { ${moduleName}Record } from "./types";
import type { PaginatedResult } from "@getstrata/core/pagination";

class ${moduleName}Service {
  constructor(private readonly repository: ${moduleName}Repository) {}

  paginate(options: {
    page: number;
    perPage: number;
  }): Promise<PaginatedResult<${moduleName}Record>> {
    return this.repository.paginate(options);
  }

  findByIdOrThrow(id: number): Promise<${moduleName}Record> {
    return this.repository.findByIdOrThrow(id, () => new NotFoundError("${moduleName} not found."));
  }

  create(input: { name: string }): Promise<${moduleName}Record> {
    return this.repository.create(input);
  }

  update(id: number, input: { name?: string }): Promise<${moduleName}Record> {
    return this.repository.updateByIdOrThrow(id, input, () => new NotFoundError("${moduleName} not found."));
  }

  async delete(id: number): Promise<void> {
    if (!(await this.repository.deleteById(id))) {
      throw new NotFoundError("${moduleName} not found.");
    }
  }
}

export default ${moduleName}Service;
`,
    ],
    [
      "policy.ts",
      `import type { AuthUser } from "@getstrata/core/auth/authContext";
import { Policy } from "@getstrata/core/auth/policy";
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
      `import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
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
      `import { parseJsonBody, parsePositiveIntParam } from "@getstrata/core/http/validation";
import { parsePaginationQuery } from "@getstrata/core/http/pagination";
import {
  maxLength,
  minLength,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

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
      `import { toPaginatedResourceCollection, toResourceCollection } from "@getstrata/core/http/resources";
import type { PaginationMeta } from "@getstrata/core/pagination";
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
      `import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { bindRouteModel } from "@getstrata/core/http/routeModelBinding";
import { buildRequestCacheKey } from "@getstrata/core/http/validation";
import { securedBindRouteModel } from "@getstrata/core/http/securedRouteModelBinding";
import type { RouteRequest } from "@getstrata/core/http/route";
import { createdResponse, jsonResponse, noContentResponse, withErrorHandling } from "@getstrata/core/http/response";
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
      async (_request: RouteRequest<${moduleName}IdParams>, record) => {
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
      async (_request: RouteRequest<${moduleName}IdParams>, record) => {
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
      `import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";
${withWeb ? 'import { apiPrefix } from "@getstrata/core/runtime/appKeyPrefix";\n' : ""}import ${moduleName}Controller from "./controller";

function create${moduleName}Routes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new ${moduleName}Controller(dependencies, cachedJson);
${withWeb ? `  const apiBase = \`\${apiPrefix()}/${pluralSlug}\`;\n` : ""}

  return {
    ${withWeb ? "[apiBase]" : `"/${pluralSlug}"`}: {
      GET: controller.index,
      POST: kernel.wrapAbility(
        "${pluralSlug}:create",
        controller.store,
      ),
    },
    ${withWeb ? `[\`\${apiBase}/:id\`]` : `"/${pluralSlug}/:id"`}: {
      GET: controller.show,
      PATCH: kernel.wrapAbility(
        "${pluralSlug}:update",
        controller.update,
      ),
      DELETE: kernel.wrapAbility(
        "${pluralSlug}:delete",
        controller.destroy,
      ),
    },
  };
}

export { create${moduleName}Routes };
`,
    ],
    [
      "index.ts",
      `import { type AppModule } from "@getstrata/bootstrap/contracts";
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

  const webFiles = new Map<string, string>();
  const viewFiles = new Map<string, string>();

  if (withWeb) {
    viewFiles.set(
      "index.eta",
      `<section class="page-header">
  <h1>${moduleName}s</h1>
</section>

<p class="hint">Generated web view for ${pluralSlug}. Wire up ${moduleName}WebController next.</p>
`,
    );

    webFiles.set(
      "webController.ts",
      `import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { withErrorHandling } from "@getstrata/core/http/response";
import { CORE_VIEW_RENDERER_TOKEN, type NamespacedViewRenderer } from "@getstrata/core/view";
import { ${moduleIdentifier}ServiceToken } from "./provider";
import { parse${moduleName}ListQuery } from "./requests";
import type ${moduleName}Service from "./service";

class ${moduleName}WebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): ${moduleName}Service {
    return resolveService(this.dependencies, ${moduleIdentifier}ServiceToken);
  }

  private get views(): NamespacedViewRenderer {
    return resolveService(this.dependencies, CORE_VIEW_RENDERER_TOKEN).namespace("${pluralSlug}");
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parse${moduleName}ListQuery(request);
    const result = await this.service.paginate(query);

    return this.views.renderHtmx("index.eta", {
        layout: { title: "${moduleName}s" },
        records: result.data,
        meta: result.meta,
      }, { request },
    );
  });
}

export default ${moduleName}WebController;
`,
    );

    webFiles.set(
      "webRoutes.ts",
      `import type { AppDependencies } from "@getstrata/core/contracts/di";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import ${moduleName}WebController from "./webController";

function create${moduleName}WebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new ${moduleName}WebController(dependencies);

  return {
    "/${pluralSlug}": {
      GET: kernel.wrapWebPublicRead(controller.index),
    },
  };
}

export { create${moduleName}WebRoutes };
`,
    );
  }

  return { files, webFiles, viewFiles, pluralSlug };
}

export { renderModuleScaffold };
