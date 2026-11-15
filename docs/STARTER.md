# Starter

`bunx create-strata my-app` creates an application with the selected layers. Use
arrow keys and Enter in the wizard; Space toggles compatible extras. For automated
or repeatable generation, pass `--yes` and explicit options.

If Bun reuses an older cached generator, try `bunx create-strata@latest my-app` from outside an existing project. The explicit tag is optional for normal use.

## Quick start

```sh
bunx create-strata my-app --frontend server-htmx --database sqlite --auth cookie --no-docker --yes
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

Bun runs the application; generated projects use TypeScript for checking. Use the
app's scripts or `bunx strata <command>` from its directory. The CLI is local to
the application, not a required global installation.

With only `--yes`, defaults are JSON API, SQLite and development header auth. Select
an appropriate real authentication mode for applications with user accounts.

## Layers

| Flag | Values |
| --- | --- |
| `--frontend` | `api`, `server-htmx`, `spa-react`, `hybrid` |
| `--database` | `sqlite`, `postgres`, `mysql`; one primary database |
| `--auth` | `headers`, `cookie`, `token`, `jwt`, `cookie-token`, `cookie-token-jwt` |
| `--tenancy` | `none`, `column`, `rls`; RLS requires PostgreSQL, other engines use column mode |
| `--cache` | `array`, `redis` |
| `--queue` | `sync`, `redis` |
| `--mail` | `log`, `smtp` |
| `--spa-prefix` | SPA mount path, default `/app` |

Extras: `--mfa`, `--email-verification`, `--scim`, `--metrics`, `--oauth-github`,
`--oidc`, `--billing`, `--webhooks`; use the corresponding `--no-*` flag to disable
one. Compatibility depends on the selected auth/frontend layers. Header auth has
no persisted account or password flow. MFA and browser OAuth handshakes need a
cookie stack; SCIM and email verification need persisted users. Consult
`bunx create-strata --help` and [integrations](INTEGRATIONS.md).

Generated configuration and dependencies match the selection. Adding a different
layer later may require application code and migrations as well as environment
changes. Installing newer framework packages does not regenerate app-owned files.

## Docker or local services

| Flag | Behavior |
| --- | --- |
| `--docker` | Generate Compose for required services |
| `--no-docker` | Use locally available services; no Compose file |
| `--docker-services=postgres,redis` | Generate only the selected compatible services |

`--yes` does not imply Docker. Add `adminer` explicitly to `--docker-services` for
a PostgreSQL/MySQL UI; the interactive wizard also offers it. Start the debug
profile with `docker compose --profile debug up -d --wait`. Adminer binds to
`127.0.0.1:8080`. The generated README contains the selected service names and
local credentials. They are for development, not production.

PostgreSQL applications use a restricted runtime role. Migrations/provisioning use
separate administrative credentials. See [PostgreSQL provisioning](POSTGRES-PROVISIONING.md)
and [production configuration](PRODUCTION.md).

## AI coding agents

Every generated application includes `AGENTS.md` with its selected frontend,
database, auth, tenancy and service choices. It explains where product features
belong, how to use public model/controller APIs, preserve access controls and run
the app's actual commands. React and worker guidance appears only where applicable.
The generated README links to it. Update the guide as your application evolves;
installed versions and current code remain authoritative.

## Find application code

```text
src/
  models/                 Model classes; register.ts lists app models
  http/controllers/       Selected auth, home and integration actions
  http/requests/          Form requests when needed
  policies/               Resource policies when needed
  routes/api.ts           API routes and middleware
  routes/web.ts           Browser routes and middleware
  routes/index.ts         Startup route composition
  db/migrations/          Explicit schema changes
  config/                 App configuration
```

Only selected features are emitted; optional folders need not contain placeholders.
Start at a route, follow its controller, then the request, policy and model. Read
bootstrap code when configuring dependencies or lifecycle, not for ordinary CRUD.

```sh
bunx strata make:model Product
bunx strata make:migration create_products
bunx strata make:controller ProductController
bunx strata make:request StoreProductRequest
bunx strata make:policy ProductPolicy
```

Declare model fields once, register the class, implement its migration and connect
controller actions with explicit validation and authorization. Ordinary CRUD needs
no repository declaration or forwarding service. Larger features can use
`make:module` and optional `--with-web` scaffolding. See
[application workflow](BUILDING-APPS.md), [database](DATABASE.md), and
[uploads/images](MEDIA.md).

## Accounts, migrations and workers

- Every app has a Note model/schema; scaffolding does not grant arbitrary CRUD access.
- User-auth layers add the relevant models and account routes. API/SPA account flows
  use JSON; HTMX/hybrid cookie modes also provide editable HTML views and CSS.
- Login forms are empty by default. `bun run db:seed:demo` is explicit and permitted
  only in development/test. Migrations and resets do not implicitly seed accounts.
- Use `auth:provision-admin` for the generated one-time administrator setup instead
  of production demo seeding. See [initial admin](INITIAL-ADMIN.md).
- File migrations live in `src/db/migrations/`; migration history is separate from
  application data. Do not modify already applied migrations.
- Run Redis jobs with `queue:work` and SQL durable listeners with `outbox:work` in
  separate processes using the same application configuration. HTTP startup does not
  start these workers. See [queues](QUEUES.md) and [scheduling](SCHEDULER.md).
- `/health` checks dependency and schema readiness; `/ready` checks dependencies.
  Neither endpoint returns application data. Run migrations before expecting health.

Keep authentication, resource permissions and tenant filters explicit. Development
header auth is not a production login method. See [auth](AUTH.md) and
[tenancy](TENANCY.md).

## React and hybrid applications

`SPA_PREFIX` controls the backend mount, router basename and built asset paths.
Changing it requires rebuilding the frontend; Docker build and runtime values must
agree. Only public configuration reaches the browser bundle.

```sh
bun run frontend:install
bun run frontend:build
bun run frontend:dev
```

Use the generated README for backend/frontend startup and preview commands. Bun's
native frontend development server supplies HMR and proxies API calls to the backend.
The SPA lives under its configured prefix; API misses remain API misses.

Cookie modes use HttpOnly sessions. Pure token/JWT modes keep bearer credentials in
memory, not localStorage/sessionStorage, and require sign-in after a reload. Account
writes keep the CSRF handshake; header-auth demos expose development identity
controls rather than pretending to offer password registration.
