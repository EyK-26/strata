interface RlsModuleNames {
	moduleSlug: string;
	moduleName: string;
	moduleIdentifier: string;
}

function renderRlsModuleScaffold(
	{ moduleSlug, moduleName, moduleIdentifier }: RlsModuleNames,
	migrationName: string,
) {
	const table = `module_${moduleSlug.replaceAll('-', '_')}`;

	const index = `${table}_tenant_id_id_idx`;

	if (index.length > 63) {
		throw new Error('The RLS module name is too long for PostgreSQL identifiers.');
	}

	const collection = `${moduleSlug}s`;

	const files = new Map([
		[
			`models/${moduleName}.ts`,
			`import { defineModel, field } from "@getstrata/core/database/model";

export class ${moduleName} extends defineModel({
  table: "${table}",
  fields: { id: field.number(), tenant_id: field.number(), name: field.string() },
  defaultOrderBy: { column: "id", direction: "ASC" },
}) {
  static $fillable = ["name"] as const;
  static $timestamps = false;
}
`,
		],
		[
			`policies/${moduleName}Policy.ts`,
			`import { Policy } from "@getstrata/core/auth/policy";

export class ${moduleName}Policy extends Policy {}
`,
		],
		[
			`http/requests/${moduleName}Request.ts`,
			`import { FormRequest } from "@getstrata/core/http/formRequest";
import { maxLength, minLength, required, stringRule, validateObject } from "@getstrata/core/validation/rules";

export class Save${moduleName}Request extends FormRequest<{ name: string }> {
  protected parse(payload: unknown): { name: string } {
    const data = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
    });

    return { name: data.name as string };
  }
}
`,
		],
		[
			'index.ts',
			`import type { AppModule } from "@getstrata/bootstrap/contracts";
import { ${moduleName}Policy } from "./policies/${moduleName}Policy";
import { create${moduleName}Routes } from "./routes";

const ${moduleIdentifier}Module: AppModule = {
  name: "${moduleSlug}",
  order: 100,
  policies: { "${moduleSlug}": new ${moduleName}Policy() },
  routes({ kernel }) {
    return create${moduleName}Routes(kernel);
  },
};

export default ${moduleIdentifier}Module;
`,
		],
		[
			'routes.ts',
			`import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { NotFoundError } from "@getstrata/core/errors/http";
import { parsePaginationQuery } from "@getstrata/core/http/pagination";
import { noContentResponse, privateJsonResponse } from "@getstrata/core/http/response";
import type { RouteRequest } from "@getstrata/core/http/route";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { Save${moduleName}Request } from "./http/requests/${moduleName}Request";
import { ${moduleName} as ModuleModel } from "./models/${moduleName}";

type RecordRequest = RouteRequest<{ id: string }>;

const input = new Save${moduleName}Request();

export function create${moduleName}Routes(kernel: HttpKernel) {
  return {
    "/${collection}": {
      GET: kernel.wrapAbility(
        "${collection}:list",
        kernel.wrapPolicy("${moduleSlug}", "view", async (request, { database }) => {
          const page = parsePaginationQuery(request);

          const { data, meta } = await database.model(ModuleModel).query().paginate(page);

          return privateJsonResponse({ data: data.map(resource), meta });
        }),
      ),
      POST: kernel.wrapAbility(
        "${collection}:create",
        kernel.wrapPolicy("${moduleSlug}", "create", async (request, { database, established }) => {
          const data = await input.validate(request);

          const record = await database.model(ModuleModel).create(data, {
            tenant_id: established.tenant.id,
          });

          return privateJsonResponse(resource(record), { status: 201 });
        }),
      ),
    },
    "/${collection}/:id": {
      GET: kernel.wrapAbility(
        "${collection}:view",
        async (request: RecordRequest, { database, auth, established }) => {
          const record = await find(database.model(ModuleModel), request);

          await kernel.routeModelBindingPorts(auth).authorize("${moduleSlug}", "view", established.auth.user, record);

          return privateJsonResponse(resource(record));
        },
      ),
      PATCH: kernel.wrapAbility(
        "${collection}:update",
        async (request: RecordRequest, { database, auth, established }) => {
          const record = await find(database.model(ModuleModel), request);

          await kernel.routeModelBindingPorts(auth).authorize("${moduleSlug}", "update", established.auth.user, record);
          await record.update(await input.validate(request));

          return privateJsonResponse(resource(record));
        },
      ),
      DELETE: kernel.wrapAbility(
        "${collection}:delete",
        async (request: RecordRequest, { database, auth, established }) => {
          const record = await find(database.model(ModuleModel), request);

          await kernel.routeModelBindingPorts(auth).authorize("${moduleSlug}", "delete", established.auth.user, record);
          await record.delete();

          return noContentResponse();
        },
      ),
    },
  };
}

async function find(
  records: { find(id: number): Promise<ModuleModel | null> },
  request: RecordRequest,
) {
  const record = await records.find(parsePositiveIntParam(request.params.id, "id"));

  if (!record) {
    throw new NotFoundError();
  }

  return record;
}

function resource(record: ModuleModel) {
  return { id: record.get("id"), name: record.get("name") };
}
`,
		],
	]);

	const migration = `import { currentSqlDialect } from "@getstrata/core/database/dialect";
import type { Migration } from "@getstrata/core/database/migrations/types";
import { enableTenantRlsSql } from "@getstrata/core/tenant/enableTenantRls";

const migration: Migration = {
  name: "${migrationName}",

  async up(db) {
    if (currentSqlDialect().driver !== "pgsql") {
      throw new Error("This migration requires PostgreSQL RLS.");
    }

    // One PostgreSQL query publishes the table and its policy atomically.
    await db.unsafe([
      'CREATE TABLE "${table}" (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenant(id), name VARCHAR(120) NOT NULL);',
      'CREATE INDEX "${index}" ON "${table}" (tenant_id, id);',
      enableTenantRlsSql("${table}"),
    ].join("\\n"));
  },

  async down(db, context) {
    if (currentSqlDialect().driver !== "pgsql") {
      throw new Error("This migration requires PostgreSQL RLS.");
    }

    if (context?.operation === "fresh") {
      await db.unsafe('DROP TABLE "${table}"');

      return;
    }

    await db.unsafe(\`
SET LOCAL row_security = off;
DO $rollback$
BEGIN
  LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM "${table}") THEN
    RAISE EXCEPTION 'Cannot roll back ${table} while it contains data.';
  END IF;
  DROP TABLE "${table}";
END
$rollback$;
\`);
  },
};

export default migration;
`;

	return { files, migration };
}

export { renderRlsModuleScaffold };
