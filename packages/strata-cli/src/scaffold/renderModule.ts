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
      `models/${moduleName}.ts`,
      `import { defineModel, field, type ModelAttributes } from "@getstrata/core/database/model";

class ${moduleName} extends defineModel({
  table: "${moduleSlug}",
  fields: { id: field.number(), name: field.string() },
  defaultOrderBy: { column: "id", direction: "ASC" },
}) {
  static $fillable = ["name"] as const;
  static $timestamps = false;
}

type ${moduleName}Record = ModelAttributes<${moduleName}>;
export { ${moduleName} };
export type { ${moduleName}Record };
`,
    ],
    [
      `policies/${moduleName}Policy.ts`,
      `import type { AuthUser } from "@getstrata/core/auth/authContext";
import { Policy } from "@getstrata/core/auth/policy";
import type { ${moduleName}Record } from "../models/${moduleName}";

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
      `http/requests/${moduleName}Requests.ts`,
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
import type { ${moduleName}Record } from "./models/${moduleName}";

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
      `http/controllers/${moduleName}Controller.ts`,
      `import type { BusinessRequestPorts } from "@getstrata/bootstrap/persistenceContracts";
import type { CachedJson } from "@getstrata/core/contracts/di";
import { bindRouteModel } from "@getstrata/core/http/routeModelBinding";
import { buildRequestCacheKey } from "@getstrata/core/http/validation";
import {type RouteModelBindingPorts, securedBindRouteModel } from "@getstrata/core/http/securedRouteModelBinding";
import type { RouteRequest } from "@getstrata/core/http/route";
import { createdResponse, jsonResponse, noContentResponse } from "@getstrata/core/http/response";
import { NotFoundError } from "@getstrata/core/errors/http";
import { ${moduleName} } from "../../models/${moduleName}";
import {
  parseCreate${moduleName}Body,
  parse${moduleName}ListQuery,
  parseUpdate${moduleName}Body,
  type ${moduleName}IdParams,
} from "../requests/${moduleName}Requests";
import {
  to${moduleName}PaginatedResourceCollection,
  to${moduleName}Resource,
} from "../../resources";

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

  private get records() {
    return this.database.model(${moduleName});
  }

  private find(id: number) {
    return this.records.findOrFail(id, () => new NotFoundError("${moduleName} not found."));
  }

  readonly index = (async (request?: Request) => {
    const query = parse${moduleName}ListQuery(request);
    const cacheKey = buildRequestCacheKey("/${pluralSlug}", request);

    return await this.cachedJson(
      cacheKey,
      async () => {
        const result = await this.records.query().paginate(query);
        return to${moduleName}PaginatedResourceCollection(result.data.map((record) => record.toObject()), result.meta);
      },
      [${moduleIdentifier.toUpperCase()}_CACHE_TAG],
      request,
    );
  });

  readonly show = (
    bindRouteModel(
      "id",
      (id) => this.find(id),
      async (_request: RouteRequest<${moduleName}IdParams>, record) => {
        return jsonResponse(to${moduleName}Resource(record.toObject()));
      },
    )
  );

  readonly store = (async (request: Request) => {
    const body = await parseCreate${moduleName}Body(request);
    const record = await this.records.create(body);
    return createdResponse(to${moduleName}Resource(record.toObject()));
  });

  private bindUpdate(binding:RouteModelBindingPorts) {return securedBindRouteModel(
      "id",
      (id) => this.find(id),
      { resource: "${moduleSlug}", action: "update" },
      async (req: RouteRequest<${moduleName}IdParams>, record) => {
        const body = await parseUpdate${moduleName}Body(req);
        const updated = await record.update(body);
        return jsonResponse(to${moduleName}Resource(updated.toObject()));
      },
      binding,
    );
  }

  private bindDestroy(binding:RouteModelBindingPorts) {return securedBindRouteModel(
      "id",
      (id) => this.find(id),
      { resource: "${moduleSlug}", action: "delete" },
      async (_request: RouteRequest<${moduleName}IdParams>, record) => {
        await record.delete();
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
import type { BusinessRequestPorts } from "@getstrata/bootstrap/persistenceContracts";
import type { RouteRequest } from "@getstrata/core/http/route";
import type { ${moduleName}IdParams } from "./http/requests/${moduleName}Requests";
import type { CachedJson } from "@getstrata/core/contracts/di";
${withWeb ? 'import { apiPrefix } from "@getstrata/core/runtime/appKeyPrefix";\n' : ""}import ${moduleName}Controller from "./http/controllers/${moduleName}Controller";

function create${moduleName}Routes(
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
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
import ${moduleName}Controller from "./http/controllers/${moduleName}Controller";
import ${moduleName}Policy from "./policies/${moduleName}Policy";
import { create${moduleName}Routes } from "./routes";${
        withWeb
          ? `
import { create${moduleName}WebRoutes } from "./webRoutes";`
          : ""
      }

const ${moduleVariable}: AppModule = {
  name: "${moduleSlug}",
  order: 100,
  tableName: "${moduleSlug}",
  cacheTags: ["${pluralSlug}"],
  policies: { "${moduleSlug}": new ${moduleName}Policy() },
  routes({ cachedJson, kernel }) {
    return create${moduleName}Routes(cachedJson, kernel);
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
export { ${moduleName}Controller };
export { parse${moduleName}IdParams, parse${moduleName}ListQuery } from "./http/requests/${moduleName}Requests";
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
export { ${moduleName} } from "./models/${moduleName}";
export type { ${moduleName}Record } from "./models/${moduleName}";
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
      `http/controllers/${moduleName}WebController.ts`,
      `import type { BusinessRequestPorts } from "@getstrata/bootstrap/persistenceContracts";
import type { NamespacedViewRenderer } from "@getstrata/core/view";
import { ${moduleName} } from "../../models/${moduleName}";
import { parse${moduleName}ListQuery } from "../requests/${moduleName}Requests";

class ${moduleName}WebController {
  constructor(private readonly views: NamespacedViewRenderer, private readonly database: BusinessRequestPorts["database"]) {}

  private get records() {
    return this.database.model(${moduleName});
  }

  readonly index = (async (request?: Request) => {
    const query = parse${moduleName}ListQuery(request);
    const result = await this.records.query().paginate(query);

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
      `import { resolveService, type AppDependencies } from "@getstrata/core/contracts/di";
import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { BusinessRequestPorts } from "@getstrata/bootstrap/persistenceContracts";
import ${moduleName}WebController from "./http/controllers/${moduleName}WebController";

function create${moduleName}WebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const views = resolveService(dependencies, CORE_VIEW_RENDERER_TOKEN).namespace("${pluralSlug}");
  return {
    "/${pluralSlug}": {
      GET: kernel.wrapWebPublicRead((request: Request, ports: BusinessRequestPorts) => new ${moduleName}WebController(views, ports.database).index(request)),
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
