import type { StarterFeaturePlan } from './featurePlan.ts';

/** Consumer instructions follow the selected app, never the framework contributor workspace. */
export function renderAgentInstructions(projectName: string, plan: StarterFeaturePlan): string {
	const { layers, decisions, services } = plan;

	const extras = Object.entries(layers.extras)
		.filter(([, enabled]) => enabled)
		.map(([name]) => name)
		.sort();

	return `# Building ${projectName}

This is an application built with Strata, TypeScript and Bun. Build product features
in this app using the installed public APIs; do not recreate framework internals or
edit node_modules. Follow Laravel-style organization where it fits TypeScript.

## Start here

Read README.md, package.json and the files involved in the feature. Installed package
versions and current application code take precedence over generic examples. Runtime
choices live in src/config/app.ts and environment configuration. strata.layers.json
records generation choices; editing it does not reconfigure the application.
Update this guide when the app's structure or stack changes. Do not print secrets
from .env or commit credentials.

Starting stack: frontend=${layers.frontend}; database=${layers.database}; auth=${layers.auth};
tenancy=${layers.tenancy}; cache=${layers.cache}; queue=${layers.queue}; mail=${layers.mail}.
Selected extras: ${extras.join(', ') || 'none'}.

## Where features belong

- src/routes/api.ts and src/routes/web.ts: endpoints and their middleware.
- src/http/controllers/: named actions; create a controller when needed.
- src/http/requests/: input validation and request authorization when needed.
- src/policies/: resource access rules when needed.
- src/models/: model classes; add new classes to src/models/register.ts.
- src/db/migrations/: explicit schema changes, separate from model declarations.
${decisions.users ? '- src/db/factories/UserFactory.ts: user test data with explicit credentials and invocation-owned persistence.\n' : ''}- src/db/seed.ts: explicit development-only seed entrypoint.
- src/config/app.ts and src/bootstrap/: configuration and dependency composition.
${decisions.serverViews || decisions.mfaViews ? '- views/: Eta templates; use the existing view rendering and escaping helpers.\n' : ''}${decisions.frontendBuild ? `- frontend/: React UI built by Bun; preserve the configured SPA prefix (${layers.spaPrefix}).\n` : ''}
Optional folders need not exist until their first feature is added. Larger domains
may use modules; ordinary CRUD needs no module, forwarding service or repository layer.

## Add a feature

Use the local CLI from this directory; inspect each command's help before guessing flags:

\`\`\`sh
bunx strata make:model Product
bunx strata make:migration create_products
bunx strata make:controller ProductController
bunx strata make:request StoreProductRequest
bunx strata make:policy ProductPolicy
\`\`\`

1. Declare model fields once with defineModel and field from
   @getstrata/core/database/model. Infer row types with ModelAttributes when needed.
   Put relationships on the model class, for example
   category() { return this.belongsTo(Category, "category_id"); }.
   Register both model classes. Ordinary models need no separate XxxRepository.
2. Implement a new migration for the actual table/columns/indexes. Model declarations
   do not change the database. Keep applied migrations intact.
3. Validate input in a request and authorize the operation/resource. A fillable list
   is not authorization. Derive identity/ownership values from trusted context.
4. Put application behavior in the controller or a service that adds real domain
   behavior. Register routes through the existing kernel/middleware composition.
5. Query through database.model(Product), or transaction.model(Product) inside its
   transaction. Never cache a request session, identity or bound model in a singleton.
   Keep after-commit effects inside the existing transaction-aware workflow.
6. Add focused tests for successful, denied and invalid operations. Check persisted
   outcomes and rollback when a feature changes data.

Use @getstrata/core/... and @getstrata/bootstrap/... public subpaths. Inspect installed
types and neighboring app code before inventing an API. Pass narrow dependencies to
controllers; do not pass the whole container. Prefer native Bun HTTP, SQL, streaming
and image capabilities through Strata's APIs instead of adding duplicate frameworks.

## Access and the selected stack

${layers.auth === 'headers' ? 'Development header auth is selected. It is not a production login mechanism; adopt an appropriate real guard before exposing private data.\n' : 'Keep the generated authentication and account-state checks. Authentication, abilities and resource policies are separate checks; do not bypass them in a new endpoint.\n'}${decisions.cookie ? 'Preserve the existing cookie/CSRF handshake and server-side session handling. Do not store session credentials in browser storage or mint cookies in controllers.\n' : ''}${decisions.token || decisions.jwt ? 'Preserve bearer-token/JWT verification and expiry. Do not persist bearer credentials in localStorage or sessionStorage, or treat unverified claims as identity.\n' : ''}${decisions.rls ? 'PostgreSQL RLS is selected. Keep runtime access on the restricted app role and tenant policy inside the owned transaction; administrative migration credentials never belong in request handlers.\n' : decisions.tenantTable ? 'Column tenancy is selected. Explicitly filter tenant-owned reads and writes using the trusted current tenant; a tenant_id column alone does not isolate records.\n' : 'No tenancy is selected. Do not invent tenant fields or middleware without adding the corresponding schema and application policy.\n'}${layers.database === 'sqlite' ? 'SQLite is selected. Use its configured file and portable schema/query APIs; do not assume PostgreSQL RLS or full-text operators are available.\n' : ''}${decisions.redisQueue ? 'Redis queued work needs a separate bun run queue:work process. Make job effects idempotent and preserve retry/cancellation semantics.\n' : 'The queue is synchronous; HTTP startup does not create a background queue worker.\n'}Only run bun run outbox:work when this application uses SQL durable listeners.
${layers.mail === 'log' ? 'Mail is logged locally; configure an actual mail transport before relying on delivered account emails.\n' : 'SMTP is selected; use the configured transport and preserve failure/retry handling without logging credentials.\n'}
## Commands and validation

Use the Bun version in .bun-version. Follow README.md for environment setup and
${services.docker.length ? `selected Docker services (${services.docker.join(', ')}).` : services.local.length ? `local services (${services.local.join(', ')}).` : 'local startup; this selection needs no supporting service containers.'}

\`\`\`sh
bun install
bun run check
bun run db:migrate
bun run dev
${decisions.frontendBuild ? 'bun run frontend:install\nbun run frontend:build\n' : ''}\`\`\`

Run migrations against the intended development database after reviewing the changes.
db:fresh is destructive; never use it on shared or production data. Demo seeds are
development-only. Use disposable test data. Run existing focused tests with bun test
when present; do not assume this app defines test, lint or framework-monorepo scripts.
Inspect package.json for additional commands and add application tests where needed.

Keep changes small and inspect the diff. Avoid reading unrelated files or repeatedly
running full suites. Recheck affected behavior after edits; report what ran and what
remains unverified. Do not replace a failed check with a weaker assertion. Keep new
dependencies, public APIs and infrastructure proportional to the product requirement.

## Framework reference

- [Application workflow](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
- [Models and migrations](https://github.com/EyK-26/strata/blob/main/docs/DATABASE.md)
- [Authentication](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md)
- [Tenancy](https://github.com/EyK-26/strata/blob/main/docs/TENANCY.md)
- [Uploads and images](https://github.com/EyK-26/strata/blob/main/docs/MEDIA.md)

Documentation on main may be newer than the installed release. Keep this app's
versions and public type contracts authoritative. Adding a feature should not require
studying Strata's contributor workspace or changing framework package versions.
`;
}
