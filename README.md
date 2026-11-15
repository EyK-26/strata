# Strata

Laravel-inspired application structure and developer experience, built for
TypeScript and Bun. Strata combines named models, controllers, requests, policies,
migrations and jobs with Bun's native HTTP, SQL, file, image and build capabilities.

## Create an application

Install [Bun](https://bun.sh) **1.4.4 or later**. The repository and generated Docker
images pin the tested runtime in [.bun-version](.bun-version).

This local HTML starter uses SQLite and needs no database container:

```sh
bunx create-strata my-app --frontend server-htmx --database sqlite --auth cookie --no-docker --yes
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

Read the generated README for your selected configuration. Demo data is opt-in via
`bun run db:seed:demo` and is restricted to development/test environments. Replace
development secrets before deployment.

Run `bunx create-strata my-app` for the interactive wizard. Choose an API, HTMX,
React SPA or hybrid frontend; PostgreSQL, MySQL or SQLite; authentication, tenancy,
cache, queue, mail and optional integrations. Docker infrastructure is optional.
See [starter options](docs/STARTER.md).

## Familiar application code

```text
src/
  models/                 Model classes and registration
  http/controllers/       Request handlers
  http/requests/          Input validation and authorization
  policies/               Resource access rules
  routes/api.ts           API routes and middleware
  routes/web.ts           Browser routes and middleware
  db/migrations/          Database schema changes
  config/                 Application configuration
```

Files are generated for selected features or created with `make:*` commands;
optional directories need not exist in a new app. Domain modules are available
when a larger application benefits from grouping a feature together.

```ts
import { defineModel, field } from "@getstrata/core/database/model";

export class Note extends defineModel({
  table: "notes",
  fields: { id: field.number(), body: field.string() },
}) {
  static $fillable = ["body"] as const;
  static $timestamps = false;
}
```

Register the class in `src/models/register.ts` and create its table with a migration.
Inside an owned database session, use `database.model(Note)` or
`transaction.model(Note)`. Add relationship methods to the class. Ordinary models
need no separate repository or repeated row interface. Controllers receive explicit
capabilities; request sessions and tenant identities stay within their execution.

Start with [building an application](docs/BUILDING-APPS.md). Prefer focused package
imports such as `@getstrata/core/database/model` over the root barrel.

## Guides

| Task | Guide |
| --- | --- |
| Generate an app or feature | [Starter](docs/STARTER.md), [application workflow](docs/BUILDING-APPS.md) |
| Models, relationships and migrations | [Database](docs/DATABASE.md) |
| Authentication and access control | [Auth](docs/AUTH.md), [tenancy](docs/TENANCY.md), [initial admin](docs/INITIAL-ADMIN.md) |
| Uploads, images and storage | [Media](docs/MEDIA.md), [storage](docs/STORAGE.md) |
| Background work | [Queues](docs/QUEUES.md), [scheduler](docs/SCHEDULER.md) |
| External services and deployment | [Integrations](docs/INTEGRATIONS.md), [production](docs/PRODUCTION.md) |

## Packages

Package version: **3.1.4** (this checkout; publication is tracked on npm).

| Package | Purpose |
| --- | --- |
| `@getstrata/core` | Runtime, HTTP, authentication, database, jobs, storage and media |
| `@getstrata/bootstrap` | Application composition, providers and HTTP startup |
| `@getstrata/cli` | Application lifecycle, migrations, workers and scaffolding |
| `@getstrata/starter` | Configurable application generator |
| `create-strata` | Convenient generator entrypoint for `bunx` |

The five packages use one coordinated version. See their changelogs for the next
release and [npm](https://www.npmjs.com/package/@getstrata/core) for published versions.
Installing an update does not rewrite an existing application's generated files.

## AI-assisted application development

Every new application includes its own `AGENTS.md`, tailored to the selected stack.
It guides coding agents through models, controllers, requests, policies, migrations,
authorization and the application's available commands. Keep it current as the app
changes. It describes building your product using Strata's installed public APIs.

## Contributing

This checkout develops the framework. Use its package scripts and CI configuration
for validation; create a separate generated app when building a product.

```sh
bun install
docker compose up -d postgres mysql redis --wait
bunx playwright install chromium
bun run validate:host
```

The test suite exercises real PostgreSQL, MySQL and SQLite behavior and generated
applications installed from candidate packages.

MIT licensed.
