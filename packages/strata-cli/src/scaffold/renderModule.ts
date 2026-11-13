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
import { defineRepository } from "@getstrata/core/database/definitions";
import { ${moduleIdentifier}Table } from "./table";
import type { ${moduleName}Record } from "./types";

class ${moduleName}Repository extends BaseRepository<${moduleName}Record, "id"> {}
const ${moduleIdentifier}Repository = defineRepository({
  name: "${moduleSlug}.repository", table: ${moduleIdentifier}Table, dependencies: [] as const,
  create: binding => new ${moduleName}Repository(binding),
});
export { ${moduleIdentifier}Repository };
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
      `import { createServiceToken } from "@getstrata/core/contracts/token";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import ${moduleName}Policy from "./policy";

const ${moduleIdentifier}PolicyToken = createServiceToken<${moduleName}Policy>("${moduleSlug}.policy");

const ${moduleIdentifier}Provider: ServiceProvider = {
  name: "${moduleSlug}.provider",
  register({ container }) {
    container.singleton(${moduleIdentifier}PolicyToken, () => new ${moduleName}Policy());
  },
  boot({ container }) {
    const gate = container.resolve(CORE_POLICY_GATE_TOKEN);
    gate.register("${moduleSlug}", container.resolve(${moduleIdentifier}PolicyToken));
  },
};

export default ${moduleIdentifier}Provider;
export {
  ${moduleIdentifier}PolicyToken,
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
      `import type { BusinessRequestPorts } from "@getstrata/bootstrap/contracts";
import type { CachedJson } from "@getstrata/core/contracts/di";
import { bindRouteModel } from "@getstrata/core/http/routeModelBinding";
import { buildRequestCacheKey } from "@getstrata/core/http/validation";
import {type RouteModelBindingPorts, securedBindRouteModel } from "@getstrata/core/http/securedRouteModelBinding";
import type { RouteRequest } from "@getstrata/core/http/route";
import { createdResponse, jsonResponse, noContentResponse } from "@getstrata/core/http/response";
import ${moduleName}Service from "./service";
import { ${moduleIdentifier}Repository } from "./repository";
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
    private readonly database: BusinessRequestPorts["database"],
    private readonly cachedJson: CachedJson,
    binding: RouteModelBindingPorts,
  ) {
    this.update=this.bindUpdate(binding);
    this.destroy=this.bindDestroy(binding);
  }
  readonly update:(request:RouteRequest<${moduleName}IdParams>)=>Promise<Response>;
  readonly destroy:(request:RouteRequest<${moduleName}IdParams>)=>Promise<Response>;

  private get service(): ${moduleName}Service {
    return new ${moduleName}Service(this.database.repository(${moduleIdentifier}Repository));
  }

  readonly index = (async (request?: Request) => {
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

  readonly show = (
    bindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      async (_request: RouteRequest<${moduleName}IdParams>, record) => {
        return jsonResponse(to${moduleName}Resource(record));
      },
    )
  );

  readonly store = (async (request: Request) => {
    const body = await parseCreate${moduleName}Body(request);
    const record = await this.service.create(body);
    return createdResponse(to${moduleName}Resource(record));
  });

  private bindUpdate(binding:RouteModelBindingPorts) {return securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "${moduleSlug}", action: "update" },
      async (req: RouteRequest<${moduleName}IdParams>, record) => {
        const body = await parseUpdate${moduleName}Body(req);
        const updated = await this.service.update(record.id, body);
        return jsonResponse(to${moduleName}Resource(updated));
      },
      binding,
    );
  }

  private bindDestroy(binding:RouteModelBindingPorts) {return securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "${moduleSlug}", action: "delete" },
      async (_request: RouteRequest<${moduleName}IdParams>, record) => {
        await this.service.delete(record.id);
        return noContentResponse();
      },
      binding,
    );
  }
}

export default ${moduleName}Controller;
`,
    ],
    [
      "routes.ts",
      `import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { BusinessRequestPorts } from "@getstrata/bootstrap/contracts";
import type { RouteRequest } from "@getstrata/core/http/route";
import type { ${moduleName}IdParams } from "./requests";
import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";
${withWeb ? 'import { apiPrefix } from "@getstrata/core/runtime/appKeyPrefix";\n' : ""}import ${moduleName}Controller from "./controller";

function create${moduleName}Routes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  void dependencies;
  const controller = (ports: BusinessRequestPorts) => new ${moduleName}Controller(ports.database, cachedJson, kernel.routeModelBindingPorts(ports.auth));
${withWeb ? `  const apiBase = \`\${apiPrefix()}/${pluralSlug}\`;\n` : ""}

  return {
    ${withWeb ? "[apiBase]" : `"/${pluralSlug}"`}: {
      GET: kernel.wrapApi((request: Request, ports: BusinessRequestPorts) => controller(ports).index(request)),
      POST: kernel.wrapAbility(
        "${pluralSlug}:create",
        (request: Request, ports: BusinessRequestPorts) => controller(ports).store(request),
      ),
    },
    ${withWeb ? `[\`\${apiBase}/:id\`]` : `"/${pluralSlug}/:id"`}: {
      GET: kernel.wrapApi((request: RouteRequest<${moduleName}IdParams>, ports: BusinessRequestPorts) => controller(ports).show(request)),
      PATCH: kernel.wrapAbility(
        "${pluralSlug}:update",
        (request: RouteRequest<${moduleName}IdParams>, ports: BusinessRequestPorts) => controller(ports).update(request),
      ),
      DELETE: kernel.wrapAbility(
        "${pluralSlug}:delete",
        (request: RouteRequest<${moduleName}IdParams>, ports: BusinessRequestPorts) => controller(ports).destroy(request),
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
export { default as ${moduleName}Repository, ${moduleIdentifier}Repository } from "./repository";
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
      `import type { BusinessRequestPorts } from "@getstrata/bootstrap/contracts";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { CORE_VIEW_RENDERER_TOKEN, type NamespacedViewRenderer } from "@getstrata/core/view";
import { ${moduleIdentifier}Repository } from "./repository";
import { parse${moduleName}ListQuery } from "./requests";
import ${moduleName}Service from "./service";

class ${moduleName}WebController {
  constructor(private readonly dependencies: AppDependencies, private readonly database: BusinessRequestPorts["database"]) {}

  private get service(): ${moduleName}Service {
    return new ${moduleName}Service(this.database.repository(${moduleIdentifier}Repository));
  }

  private get views(): NamespacedViewRenderer {
    return resolveService(this.dependencies, CORE_VIEW_RENDERER_TOKEN).namespace("${pluralSlug}");
  }

  readonly index = (async (request?: Request) => {
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
import type { BusinessRequestPorts } from "@getstrata/bootstrap/contracts";
import ${moduleName}WebController from "./webController";

function create${moduleName}WebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  return {
    "/${pluralSlug}": {
      GET: kernel.wrapWebPublicRead((request: Request, ports: BusinessRequestPorts) => new ${moduleName}WebController(dependencies, ports.database).index(request)),
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
