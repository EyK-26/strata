# Building your own app

Strata gives Bun and TypeScript applications a familiar model, controller, request
and policy workflow. Start with `create-strata`, then edit application code in your
own project. Models describe attributes; migrations describe the database schema.

## Scaffold

```bash
bunx create-strata@latest my-app
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

Configure database settings and secrets in `.env` before migrating. The generated
README covers Docker services and React frontend installation/build steps.
Migrations do not create demo accounts; `bun run db:seed:demo` is an explicit local
option. For a production administrator, use [initial-admin provisioning](INITIAL-ADMIN.md).
The CLI is installed in the app: run package scripts or `bunx strata <command>`.
See [starter options](STARTER.md) for noninteractive generation and feature flags.

## Find application code

```text
src/
  bootstrap/createApp.ts   Application definition and startup
  config/app.ts           Frontend, tenancy and feature configuration
  models/                 Model classes and register.ts
  http/controllers/       Named HTTP controllers
  http/requests/          Input validation
  policies/               Authorization rules
  routes/api.ts           JSON endpoints
  routes/web.ts           Browser endpoints
  routes/index.ts         Startup route composition
  db/migrations/          File-based schema changes
  jobs/                   Queue jobs
  listeners/              Event listeners
views/                    Eta templates, when selected
frontend/                 React application, when selected
```

Use optional domain modules when a larger application benefits from grouping.
They are not required for ordinary CRUD features. Add a service for business work
that coordinates several operations; a forwarding service or custom repository is
unnecessary for a simple model query.

## Add a feature

```bash
bunx strata make:model Task
bunx strata make:controller TaskController
bunx strata make:request StoreTaskRequest
bunx strata make:policy TaskPolicy
bunx strata make:migration create_tasks
```

Generators never overwrite existing files or register routes/models automatically.
They do not apply migrations. `make:module Task` is an optional grouped scaffold;
use `--help` for each command's options.

Edit `src/models/Task.ts`:

```ts
import { defineModel, field } from "@getstrata/core/database/model";

export class Task extends defineModel({
  table: "tasks",
  fields: { id: field.number(), title: field.string() },
}) {
  static $fillable = ["title"] as const;
  static $timestamps = false;
}
```

Import `Task` in `src/models/register.ts` and add it to the existing
`modelDefinitions` array. Keep the other generated models. The application derives
its default repository; no `table.ts`, row interface or repository class is needed.

In the generated migration, keep its generated `name` and replace the callbacks:

```ts
up(schema) {
  schema.create("tasks", table => {
    table.id();
    table.string("title");
  });
},
down(schema) {
  schema.drop("tasks");
},
```

Run `bun run db:migrate`. For a tenant-owned feature, add its tenant column,
constraints and access rules before exposing endpoints; see [tenancy](TENANCY.md).

## Validate input in a request

Edit `src/http/requests/StoreTaskRequest.ts`:

```ts
import { FormRequest } from "@getstrata/core/http/formRequest";
import { maxLength, required, stringRule, validateObject } from "@getstrata/core/validation/rules";

export default class StoreTaskRequest extends FormRequest<{ title: string }> {
  protected parse(payload: unknown): { title: string } {
    const body = validateObject(payload, {
      title: [required(), stringRule(), maxLength(120)],
    });
    return { title: body.title as string };
  }
}
```

`FormRequest` reads JSON. Use `WebFormRequest` from
`@getstrata/core/http/webFormRequest` for HTML forms or JSON. Its optional
`{ preserveRepeated: true }` retains repeated form fields as arrays. Validate their
multiplicity explicitly. Validation does not authorize a row or replace `$fillable`.

## Write a controller and register routes

Edit `src/http/controllers/TaskController.ts`:

```ts
import type { BusinessRouteHandler } from "@getstrata/bootstrap/persistenceContracts";
import { createdResponse, jsonResponse } from "@getstrata/core/http/response";
import { Task } from "../../models/Task";
import StoreTaskRequest from "../requests/StoreTaskRequest";

export class TaskController {
  readonly index: BusinessRouteHandler = async (_request, { database }) => {
    const tasks = await database.model(Task).query().orderBy({ id: "desc" }).limit(50).get();
    return jsonResponse(tasks.map(task => task.toArray()));
  };

  readonly store: BusinessRouteHandler = async (request, { database }) => {
    const values = await new StoreTaskRequest().validate(request);
    const task = await database.model(Task).create(values);
    return createdResponse(task.toArray());
  };
}
```

Add these entries to the existing route map in `src/routes/api.ts`, keeping its
other routes and imports:

```ts
import type { AppRouteMap, ModuleRouteContext } from "@getstrata/bootstrap/contracts";
import { TaskController } from "../http/controllers/TaskController";

export function apiRoutes(context: ModuleRouteContext): AppRouteMap {
  const tasks = new TaskController();
  return {
    // Keep the application's other route entries here too.
    "/api/v1/tasks": {
      GET: context.kernel.wrapAuthenticated(tasks.index),
      POST: context.kernel.wrapAbility("tasks:create", tasks.store),
    },
  };
}
```

Use your configured API prefix if it differs from `/api/v1`. Configure the
`tasks:create` ability for the intended role/token; authentication alone does not
grant it. For row-specific decisions, implement and register `TaskPolicy`, then
apply the policy to the loaded row. A generated policy has no effect until wired
into authorization. See [authentication and policies](AUTH.md).

Controllers receive native `Request` values and return native `Response` values.
The kernel supplies request-scoped database, authentication and tenant policy
ports. Keep database sessions in the handler's execution. Application-lifetime
controllers may retain stable services, not a previous request's session.
Use transactions for multi-write workflows; see [databases](DATABASE.md).

## Views and errors

HTML apps use Eta templates in `views/`. `bunx strata make:view tasks/index` creates
a template; add its controller and route separately. Inject the configured view
renderer in route composition and call `views.render()` or `views.renderHtmx()`
with the request. Ordinary HTMX targets receive fragments; boosted/history requests
retain the layout. Escape user values with `<%= value %>`.

Keep browser endpoints in `web.ts` behind the appropriate web/auth middleware.
Cookie forms need CSRF protection. JSON boundaries retain JSON error responses;
production errors must not expose secrets or stacks. Auth pages and credential
responses use private, non-cacheable responses. See [native HTTP](NATIVE-HTTP.md)
for server options, body limits, WebSockets and response streaming.

## Background work and application lifetime

`dev` and `start` run HTTP. Run `bun run queue:work` separately for Redis jobs.

### Durable events

Publish durable outbox events in the same transaction as the business writes.
Register listeners before publishing and run `bun run outbox:work` separately.
Handlers must tolerate at-least-once delivery; use stable identities for deduplication.

### Retrying failed jobs safely

Use `bunx strata queue:failed` and `bunx strata queue:retry`. Retry retains the failed
record until queue admission succeeds; a retry is not an exactly-once guarantee.
See [queues](QUEUES.md) for worker settings and recovery.

Keep the application handle in custom entrypoints. Call
`await app.application.stop({ reason: "MANUAL" })` and inspect `result.successful`.
The owner stops admission, drains work and closes resources. Use declared providers
for shared services and startup work; see [application ownership](APPLICATION-OWNERSHIP.md).

### Adopting file migrations from a legacy inline migrate.ts

Move schema changes into `src/db/migrations` and use the generated migration runner.
Preserve existing data and migration names; upgrading packages does not rewrite
application files or deployed schemas. `migrate:fresh` is a destructive development
reset. See [migration guidance](DATABASE.md#application-migrations) before adoption.

## Continue

Run `bun run check` and test authorized, denied and invalid requests. Discover
commands with `bunx strata help`; application commands belong in `src/cli/register.ts`.
Configure entrypoints in `strata.config.ts`.

- [Databases](DATABASE.md): models, relationships, transactions and SQL limits.
- [Authentication](AUTH.md) and [tenancy](TENANCY.md): identity and data access.
- [Uploads and images](MEDIA.md) and [storage](STORAGE.md): streamed files and Bun transforms.
