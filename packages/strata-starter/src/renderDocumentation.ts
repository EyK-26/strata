import { GENERATED_POSTGRES_APP_ROLE, usesComposePostgres } from "./databaseDefaults.ts";
import { renderDockerCompose } from "./renderDocker.ts";
import { renderSupportingToolsReadme } from "./renderSupportingTools.ts";
import {
  authNeedsUsers,
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  dockerComposeUpCommand,
  type GenerateOptions,
  neededDockerServices,
  needsFrontendBuild,
  type StarterLayers,
  selectedDockerServices,
} from "./types.ts";

/**
 * Written per layer so it can only list routes this app actually serves.
 * A static template drifts the moment the auth stack changes.
 */
function renderApiDocs(projectName: string, layers: StarterLayers): string {
  const rows = ["| Method | Path | Notes |", "| --- | --- | --- |"];
  rows.push(
    "| `GET` | `/health` | Plain text `ok` (200) when configured database/Redis checks succeed and `notes` is readable (zero rows is still 200). This infrastructure probe runs outside API auth/tenancy admission, never selects a tenant or bypasses RLS, and returns no rows. `degraded` (503) when a dependency or schema check fails. Docker HEALTHCHECK uses this path. |",
    '| `GET` | `/ready` | JSON from the framework: `{"status":"ready","checks":{"database":"ok","redis":"skipped"}}` (200) or `not_ready` (503). `redis` is `ok` or `error` when `REDIS_URL` is set and `skipped` otherwise. It does not check the schema, so use `/health` as the deploy gate. |',
  );

  if (authUsesToken(layers.auth)) {
    rows.push(
      "| `POST` | `/api/v1/auth/login` | `{ email, password }` returns `{ token }`. Requires `GET /api/v1/auth/csrf` then `X-CSRF-Token`. |",
      "| `GET` | `/api/v1/auth/me` | Requires `Authorization: Bearer <token>`. |",
    );
  }
  if (authUsesJwt(layers.auth)) {
    rows.push(
      "| `POST` | `/api/auth/token` | Mints a short-lived JWT. Not an HTML session. Requires CSRF like JSON login. |",
    );
  }
  if (authUsesToken(layers.auth) || authUsesJwt(layers.auth) || authUsesCookie(layers.auth)) {
    rows.push(
      "| `POST` | `/api/v1/auth/register` | Returns neutral `{ ok: true }` (201); sign in separately. |",
      "| `POST` | `/api/v1/auth/forgot-password` | Sends a signed reset link through the mail driver. |",
      "| `POST` | `/api/v1/auth/reset-password` | Consumes the signed link. |",
      ...(authUsesToken(layers.auth) || authUsesJwt(layers.auth)
        ? ["| `GET` | `/api/user` | Current user for the active guard. |"]
        : []),
    );
  }
  if (authNeedsUsers(layers.auth)) {
    rows.push(
      "| `GET` | `/api/v1/auth/csrf` | Issues the CSRF cookie and JSON token for unauthenticated writes. |",
    );
  }
  if (authUsesCookie(layers.auth)) {
    if (!authUsesToken(layers.auth))
      rows.push(
        "| `POST` | `/api/v1/auth/login` | `{ email, password }` sets the session cookie and returns `{ ok: true }`. Requires CSRF. |",
        "| `GET` | `/api/v1/auth/me` | Current user from the session cookie. |",
      );
  }
  if (layers.extras.emailVerification && authNeedsUsers(layers.auth)) {
    rows.push(
      "| `POST` | `/api/v1/auth/verify-email` | Consumes the signed verification token; requires CSRF. |",
    );
  }
  if (authUsesCookie(layers.auth) && layers.extras.emailVerification)
    rows.push(
      "| `POST` | `/api/v1/auth/verification-notification` | Authenticated owner resend; verification is not required. Requires CSRF. |",
    );
  if (authUsesCookie(layers.auth) && layers.extras.mfa)
    rows.push(
      "| `POST` | `/api/v1/auth/confirm-password` | Verify the current password and set an epoch-bound confirmation cookie. Requires verified session and CSRF. |",
      "| `GET` | `/api/v1/auth/mfa` | Returns a fresh proposed `{ secret, otpauth }`; requires verified session. Does not enable MFA. |",
      "| `POST` | `/api/v1/auth/mfa` | `{ secret, code }` enables MFA and returns `{ recoveryCodes }` once. Requires verified session, password confirmation and CSRF; revokes prior credentials. Login again with `mfa_code`. |",
    );
  if (layers.extras.metrics) {
    rows.push(
      "| `GET` | `/metrics` | Prometheus text. Production requires `Authorization: Bearer <METRICS_TOKEN>`. |",
    );
  }
  if (layers.extras.billing) {
    rows.push(
      "| `POST` | `/billing/webhooks/stripe` | Stripe signature verification. CSRF skipped by path. Plan sync is yours. |",
      "| `GET` | `/api/v1/billing/subscription` | Current tenant (or first) subscription row. |",
    );
  }
  if (layers.extras.webhooks) {
    rows.push(
      "| (job) | `webhook.dispatch` | Discovered from `src/jobs/dispatchOutboundWebhookJob.ts`. No HTTP route. |",
    );
  }
  if (layers.extras.oauthGithub && authUsesCookie(layers.auth)) {
    rows.push(
      "| `GET` | `/auth/github` | Redirects to GitHub. 404 unless `FEATURE_OAUTH=true`. |",
      "| `GET` | `/auth/github/callback` | Exchanges the code, JIT user, MFA gate, cookie session. |",
    );
  }
  if (layers.extras.oidc && authUsesCookie(layers.auth)) {
    rows.push(
      "| `GET` | `/auth/oidc` | OIDC `createAuthorization()` plus `oidc_pkce` cookie. 404 unless `FEATURE_OAUTH=true`. |",
      "| `GET` | `/auth/oidc/callback` | Reads PKCE, exchanges the code, JIT user, MFA gate, cookie session. |",
    );
  }

  const authNote =
    layers.auth === "headers"
      ? `Auth is \`headers\`. Send \`x-authenticated-user-id\` (and optional \`x-authenticated-user-role\`) for local work and tests. There are no login endpoints and no \`users\` table. Production must set \`AUTH_DEV_HEADERS=false\`, which turns those headers off and leaves you without a guard, so pick another auth layer before you ship.`
      : authUsesToken(layers.auth)
        ? `Sign in with \`GET /api/v1/auth/csrf\` then \`POST /api/v1/auth/login\` (send \`X-CSRF-Token\`), then send \`Authorization: Bearer <token>\` on every request. Tokens are stored hashed in \`api_tokens\` and expire after \`API_TOKEN_DEFAULT_EXPIRY_DAYS\` (30 in \`.env.example\`). The response includes \`expires_at\`.`
        : authUsesCookie(layers.auth)
          ? `Sign in with \`GET /api/v1/auth/csrf\` then \`POST /api/v1/auth/login\`; preserve the session and CSRF cookies. The response sets a cookie and returns \`{ ok: true }\`. API mode does not serve HTML login or registration forms.`
          : `Mint a JWT with \`POST /api/auth/token\`, then send \`Authorization: Bearer <jwt>\`. JWTs expire; re-mint rather than refreshing in place.`;

  return `# ${projectName} API

\`FRONTEND_MODE=${layers.frontend}\`. ${
    layers.frontend === "api"
      ? "API-only: no server-rendered welcome/login pages or SPA assets. The root path is not a generated endpoint."
      : `HTML is served alongside this API. The SPA is mounted at \`${layers.spaPrefix}\`.`
  }

## Routes this app serves today

${rows.join("\n")}

There is no CRUD endpoint for the seeded \`notes\` table. Adding your own routes is the first thing you do.

## Auth

${authNote}

## Adding a route

Create a module under \`src/modules/\` and return a route map. Modules are discovered on boot.

\`\`\`typescript
// src/modules/notes/index.ts
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { Note } from "../../models/Note.ts";

const notesModule: AppModule = {
  name: "notes",
  order: 2,
  routes({ kernel }) {
    return {
      "/api/v1/notes": kernel.wrap("api", async () => {
        const bodiesById = await Note.query().orderBy({ id: "desc" }).pluck("body", "id");
        return jsonResponse({ data: Object.fromEntries(bodiesById) });
      }),
    };
  },
};

export default notesModule;
\`\`\`

Import from \`@getstrata/core/...\` subpaths rather than the package root, so singleton state such as the database pool stays shared.

## Docs

- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
- [Auth choices](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md)
- [Databases](https://github.com/EyK-26/strata/blob/main/docs/DATABASE.md)
`;
}

function renderIntegrationsReadme(layers: StarterLayers): string {
  const enabled = [
    layers.extras.oauthGithub ? "GitHub OAuth cookie login (`/auth/github`)" : null,
    layers.extras.oidc ? "OIDC cookie login (`/auth/oidc`, PKCE in `oidc_pkce`)" : null,
    layers.extras.billing
      ? "Stripe billing stub (`POST /billing/webhooks/stripe`, `GET /api/v1/billing/subscription`)"
      : null,
    layers.extras.webhooks
      ? "Outbound webhooks (`notes.created` listener + `webhook.dispatch` job)"
      : null,
  ].filter((row): row is string => row !== null);

  const lines = [
    "## Integrations",
    "",
    "OAuth, billing, outbound webhooks, SIEM, and SAML are **off by default**. Commented placeholders live in `.env.example`. Framework map: [INTEGRATIONS.md](https://github.com/EyK-26/strata/blob/main/docs/INTEGRATIONS.md).",
    "",
    "Wizard flags (any stack unless noted): `--oauth-github` and `--oidc` (cookie HTML), `--billing`, `--webhooks`. They emit modules, migrations, jobs, or listeners. `createApp` still calls `await discoverListeners()` and `await discoverJobs()`.",
    "",
  ];
  if (enabled.length > 0) {
    lines.push("Enabled in this app:", "", ...enabled.map((row) => `- ${row}`), "");
  } else {
    lines.push(
      "This app did not pass those flags. Turn a flag on and re-run `create-strata`, or copy the commented env block and add a module yourself.",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderOpenApiReadme(): string {
  return `## OpenAPI

After you add routes, regenerate and commit the spec so CI can catch drift:

\`\`\`bash
bunx strata openapi:generate
bunx strata openapi:check
\`\`\`

Put \`openapi:check\` in CI. A failure means \`docs/openapi.json\` does not match the live JSON API route map (billing, auth, webhooks, and anything else you added).

\`openapi:generate\` lists API routes only. HTML admin and storefront paths are not in that file.
`;
}

function renderReadmeIntro(
  projectName: string,
  options: Pick<GenerateOptions, "inRepoExample" | "dogfood">,
): string {
  if (options.dogfood) {
    return `# ${projectName}

This generated app is an internal acceptance fixture (migrate, seed, boot, OpenAPI, smoke). It is not a product. Framework CI generates disposable fixtures; product dogfood lives in the separate strata-shop repository. Start a product app with \`bunx create-strata\`.
`;
  }
  if (options.inRepoExample) {
    return `# ${projectName}

This is a generated sibling layer map. It is not a product and it is not CI dogfood. Framework CI generates disposable acceptance fixtures; product dogfood lives in the separate strata-shop repository. Start a product app with \`bunx create-strata\`.
`;
  }
  return `# ${projectName}

Strata app generated by \`create-strata\`.
`;
}

function renderReadme(
  projectName: string,
  layers: StarterLayers,
  options: Pick<GenerateOptions, "inRepoExample" | "dogfood"> = {},
): string {
  const docker = renderDockerCompose(projectName, layers);
  const next = [`cd ${projectName}`, "cp .env.example .env"];
  if (docker) {
    next.push(dockerComposeUpCommand(layers));
  }
  next.push("bun install");
  if (needsFrontendBuild(layers.frontend)) {
    next.push("bun run frontend:install", "bun run frontend:build");
  }
  next.push("bun run db:migrate", "bun run dev");

  const extras = Object.entries(layers.extras)
    .filter(([, on]) => on)
    .map(([key]) => key);
  const dockerServices = selectedDockerServices(layers);
  const neededTools = neededDockerServices(layers);
  const dockerLabel =
    neededTools.length === 0
      ? "not needed"
      : dockerServices.length > 0
        ? dockerServices.join(", ")
        : "off (local installs)";

  return `${renderReadmeIntro(projectName, options)}
## Layers

| Layer | Choice |
|-------|--------|
| Frontend | \`${layers.frontend}\` |
| Database | \`${layers.database}\` |
| Auth | \`${layers.auth}\` |
| Tenancy | \`${layers.tenancy}\` |
| Cache | \`${layers.cache}\` |
| Queue | \`${layers.queue}\` |
| Mail | \`${layers.mail}\` |
| SPA prefix | \`${layers.spaPrefix}\` |
| Docker Compose | ${dockerLabel} |
${extras.length > 0 ? `| Extras | ${extras.join(", ")} |\n` : ""}
This file is the map for this app. Framework guides: [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md), [Auth](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [Starter](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md), [Integrations](https://github.com/EyK-26/strata/blob/main/docs/INTEGRATIONS.md).

${renderIntegrationsReadme(layers)}
## Run it

\`\`\`bash
${next.join("\n")}
\`\`\`

Open http://localhost:3000. Health check: \`GET /health\`. Discover registered commands with \`bunx strata help\`. \`dev\` and \`start\` run HTTP only; workers are explicit, separate processes.

${layers.queue === "redis" ? "Redis jobs need `bun run queue:work` in another terminal (requires `REDIS_URL`).\n\n" : "The synchronous queue handles jobs inline; no Redis queue worker is needed for it.\n\n"}For durable events, add listeners in \`src/outbox/registry.ts\`, apply \`bun run db:migrate\`, then run \`bun run outbox:work\` in another terminal. Apps that do not publish durable events do not need this worker. Durable cache invalidation also needs the outbox worker when explicitly configured. Use the same application environment, database, Redis URL and \`APP_KEY_PREFIX\` for HTTP and its workers. An idle worker is normal; startup output confirms entry into polling, not dependency health. Stop HTTP and workers before resetting the development database.

${renderSupportingToolsReadme(projectName, layers)}${
  layers.auth !== "headers"
    ? `
For the first production admin, apply migrations and run \`bunx strata auth:provision-admin --email operator@example.test --name "Initial Operator" --password-stdin${layers.tenancy !== "none" ? " --tenant 1" : ""} < /run/secrets/initial_admin_password\` before admitting traffic. Supply your own private secret-manager-mounted file, not a demo password. Passwords require at least 16 characters and at most 72 UTF-8 bytes. Tenant-enabled applications require an existing tenant ID; this command does not create tenants. It refuses existing admins/accounts, records a transactional one-time claim, and does not mark email verified or enroll MFA. Additional admins and recovery remain explicit application administration. The command does not migrate or seed automatically.

Optional development demo accounts: run \`bun run db:seed:demo\` explicitly after migrations. This command refuses production and staging. It creates these accounts with password \`StrataDemo!ChangeMe\`:

- \`demo@example.com\` (member)
- \`admin@example.test\` (admin)
`
    : `
Header auth is on for local use. Send \`x-authenticated-user-id\` (and optional \`x-authenticated-user-role\`). Production must set \`AUTH_DEV_HEADERS=false\`.
`
}${
  authUsesCookie(layers.auth) && (layers.frontend === "server-htmx" || layers.frontend === "hybrid")
    ? `
HTML auth kit (restyle \`views/\` and \`public/assets/site.css\`):

- Welcome: \`/\`
- Sign in: \`/login\`
- Register: \`/register\`
- Forgot password: \`/forgot-password\`
- Reset password: signed \`/reset-password\` (mail log when \`MAIL_DRIVER=log\`)
${layers.extras.emailVerification ? "- Verify email: `/email/verify`\n" : ""}${layers.extras.mfa ? "- MFA challenge: `/login/mfa` and setup: `/account/mfa`\n" : ""}${layers.extras.oauthGithub ? "- GitHub: `/auth/github` (needs `FEATURE_OAUTH=true`). Failures on the callback are JSON, not the login page. State is the signed query value from `createOAuthState()`, not `createOAuthStateCookie()`.\n" : ""}${layers.extras.oidc ? "- OIDC: `/auth/oidc` (needs `FEATURE_OAUTH=true` plus `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`; otherwise the login link stays hidden and the route is 404). PKCE cookie `oidc_pkce`. Callback failures are JSON, not the login page.\n" : ""}
Cookie name is \`strata_session\`. Forms send CSRF as \`_token\`.
`
    : ""
}${
  authUsesCookie(layers.auth) &&
  (layers.frontend === "api" || layers.frontend === "spa-react" || layers.frontend === "hybrid")
    ? `
JSON cookie account flows: fetch \`GET /api/v1/auth/csrf\`, retain the cookie and send \`X-CSRF-Token\` on writes (browser clients use credentials). Register through \`POST /api/v1/auth/register\` (neutral 201), login through \`POST /api/v1/auth/login\` (session cookie), and read \`GET /api/v1/auth/me\`. Reset through \`POST /api/v1/auth/forgot-password\` then signed \`POST /api/v1/auth/reset-password\` with \`{ password }\`.
${layers.extras.emailVerification ? "Verify through signed `POST /api/v1/auth/verify-email`; authenticated unverified owners resend through `POST /api/v1/auth/verification-notification`.\n" : ""}${layers.extras.mfa ? "MFA setup: `GET /api/v1/auth/mfa`, confirm the current password through `POST /api/v1/auth/confirm-password`, then submit `{ secret, code }` to `POST /api/v1/auth/mfa`. Store the returned recovery codes safely; enrollment revokes credentials. Login again with `{ email, password, mfa_code }` using a TOTP or one-use recovery code. Missing code returns JSON 401 `mfa_required`.\n" : ""}
These routes return JSON, not account pages. The client owns account forms and handling the signed mail URL: submit to its unchanged path/query, with CSRF; opening the URL with GET does not consume a token. No HTML registration/reset page or automatic login is generated for these modes. All auth JSON is private/no-store. API docs list routes; the SPA scaffold is an example client, not a complete account-management UI.
`
    : ""
}${
  authUsesToken(layers.auth)
    ? `
Opaque token login: \`POST /api/v1/auth/login\` with \`{ "email", "password" }\`. Register: \`POST /api/v1/auth/register\`. Forgot/reset: \`POST /api/v1/auth/forgot-password\` and signed \`POST /api/v1/auth/reset-password\`. Send \`Authorization: Bearer\` after login.
`
    : ""
}${
  authUsesJwt(layers.auth)
    ? `
JWT mint: \`POST /api/auth/token\` with email and password. Short-lived. Do not use JWT as an HTML cookie session.
`
    : ""
}${
  layers.extras.metrics
    ? `
Prometheus scrape: \`GET /metrics\`. Production requires \`Authorization: Bearer <METRICS_TOKEN>\`.

Metrics default to HTTP-only. In \`src/bootstrap/server.ts\`, pass explicit \`runtimeMetrics\` options to \`bootstrapApp\`:

\`\`\`ts
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for queue observations");
const { routes, config, context } = await bootstrapApp({
  runtimeMetrics: {
    // Match the deployed Redis queue transport; this does not convert queues.
    queue: { redisUrl, transport: "streams", timeoutMs: 1000 },
    // Enable on Postgres, file-backed SQLite or URL-backed MySQL after explicitly installing the corresponding schema.
    // outbox: { sampleLimit: 500, timeoutMs: 1000 },
    // failedJobs: { sampleLimit: 500, timeoutMs: 1000 },
  },
});
\`\`\`

The generated provider drains owned SQL collectors through \`context.drain()\` before database closure, including workers and startup-failure cleanup. Keep the generated HTTP admission/drain and provider lifecycle order. Observation factories never migrate, seed, start a worker, or enable durable delivery. Missing schemas/unsupported SQL dialects produce collector failures on scrape; Dialect-specific collector schema/index and interruption requirements still apply. Tracing and selected-transaction acquisition collectors can be injected as borrowed options; their existing owners retain lifecycle/instrumentation responsibility. Shared queue/outbox/failed-job gauges use a designated target or max across replicas; never sum them. See the framework runtime metrics guide for semantics and operational qualification.
`
    : ""
}${
  needsFrontendBuild(layers.frontend)
    ? `
## Frontend

The React app lives in \`frontend/\` with its own \`package.json\`. It is not built by \`bun install\` at the root.

\`\`\`bash
bun run frontend:install
bun run frontend:build
\`\`\`

Until \`frontend/dist\` exists, \`${layers.spaPrefix}\` answers 503. Use \`bun run frontend:dev\` for the Vite-style dev server with hot reload.${
        layers.frontend === "hybrid"
          ? ` HTML stays at \`/\` and the SPA is served under \`${layers.spaPrefix}/*\`.`
          : ""
      }
`
    : ""
}${
  layers.database === "sqlite"
    ? ""
    : `
## Database

The app uses the database named in \`DATABASE_URL\` and creates it on first migrate when the connection user may. Set \`APP_DATABASE_URL\` only when migrations and the app should target a different database than \`DATABASE_URL\`.${
        usesComposePostgres(layers)
          ? ` \`.env.example\` points \`DATABASE_URL\` at \`${GENERATED_POSTGRES_APP_ROLE}\` (\`NOSUPERUSER\` \`NOBYPASSRLS\`), including \`--no-docker\`. \`db/ensure-postgres-app-role.sql\` is repeatable on an existing volume; Compose init still runs on first empty volume. The \`postgres\` superuser is for CREATE ROLE / GRANT / migrate and Adminer.`
          : ""
      }
`
}
${renderOpenApiReadme()}
## Deploy

Bun >=1.4.4 is required. \`.bun-version\` and Docker stages pin the tested 1.4.4 runtime; upgrade pins deliberately and rerun checks before deployment. Runtime and TypeScript requirements use >=1.4.4, accepting future 1.4.x patches; the bun-types override keeps transitive shims above the same minimum. Refresh and commit root/frontend lockfiles when upgrading. Updating framework packages does not rewrite an existing app Dockerfile, runtime pin or manifest.

\`Dockerfile\` builds a production image from the committed \`bun.lock\` (run \`bun install\` once and commit the lockfile).${
    needsFrontendBuild(layers.frontend) ? " The React frontend is built inside the image." : ""
  }

\`\`\`bash
docker build -t ${projectName} .
docker run --rm -p 3000:3000 --env-file .env.production ${projectName}
\`\`\`

Migrations are a deploy step, not a boot step: run \`docker run --rm --env-file .env.production ${projectName} bun run db:migrate\` before the new version takes traffic. Migrations and resets do not seed by default. Demo seeding is an explicit development command, \`bun run db:seed:demo\`, and refuses production/staging. Existing demo accounts must be disabled or have their credentials and sessions/tokens rotated before deployment.${
    layers.database === "sqlite"
      ? " SQLite stores its file in `/app/storage`; mount a volume there (`-v strata_data:/app/storage`) or the data is lost with the container."
      : ""
  }
The image sets \`APP_ENV=production\` and \`AUTH_DEV_HEADERS=false\`; everything else in the Production list below comes from your environment (the \`.env.production\` file above is one way).

## Production

\`createApp\` calls \`assertProductionSecrets()\` when \`APP_ENV=production\`. That check fails closed, so read this before your first production boot.

- Replace every \`change-me\` placeholder in \`.env\`. The guard rejects the values this generator wrote, not just empty ones.
- Set \`APP_URL\` to the public origin (for example \`https://app.example.com\`). Signed links and redirects are built from it; localhost is rejected.
- Set \`AUTH_DEV_HEADERS=false\`.
- Generated \`FEATURE_PUBLIC_READS=false\` makes \`wrapWebPublicRead\` / \`wrapPublicRead\` require login by default. Opt in per route with \`{ allowAnonymous: true }\`, or set \`FEATURE_PUBLIC_READS=true\` as their default policy. With tenancy enabled, production guests require an application-approved host resolver bound to \`CORE_PUBLIC_TENANCY_TOKEN\`; unknown hosts fail closed. Keep \`TENANT_DEV_HEADERS=false\` in production. See the framework TENANCY guide for proxy trust and rollout.
- Add explicitly approved application headers with \`CORS_ADDITIONAL_ALLOWED_HEADERS=Idempotency-Key,X-Correlation-Id\`; this extends the defaults, validates header names and never reflects requested headers. OpenAPI metadata does not grant CORS access.
- Cross-origin browser calls are off in production until you set \`CORS_ALLOWED_ORIGINS\` to explicit origins. A \`*\` entry is rejected. Non-browser clients are unaffected.
- Behind a reverse proxy or load balancer, set \`TRUST_FORWARDED_FOR=true\` so throttles and session records see the client address instead of the proxy. Only the rightmost public hop of \`X-Forwarded-For\` is trusted.
${authUsesCookie(layers.auth) ? "- Set `SESSION_SECRET` to 32+ characters.\n" : ""}${authUsesToken(layers.auth) ? "- Set `TOKEN_HASH_PEPPER`.\n" : ""}${layers.extras.scim ? "- Set `SCIM_BEARER_TOKEN`.\n" : ""}${layers.extras.metrics ? "- Set `METRICS_TOKEN`.\n" : ""}${layers.extras.oauthGithub ? "- Set `OAUTH_STATE_SECRET` and `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.\n" : ""}${layers.extras.oidc ? "- Set `OAUTH_STATE_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`. Loopback issuers work outside production; set `OIDC_ALLOW_PRIVATE=true` for other private IdPs.\n" : ""}${layers.extras.billing ? "- Set `STRIPE_WEBHOOK_SECRET` when `FEATURE_BILLING=true`.\n" : ""}${
  layers.tenancy === "rls"
    ? `- \`DATABASE_URL\` must be a \`NOBYPASSRLS\` role, not the \`postgres\` superuser. Generated apps create \`${GENERATED_POSTGRES_APP_ROLE}\` via \`db/ensure-postgres-app-role.sql\` (and Compose init on first empty volume). \`MIGRATION_DATABASE_URL\` and an explicit non-development \`STRATA_APP_PASSWORD\` belong only to the migrate/provisioning process. HTTP/workers connect to the existing role without admin credentials or role/password writes. Production boot rejects username \`postgres\` or \`root\`, then inspects \`pg_roles\` for \`rolsuper\` / \`rolbypassrls\`.
`
    : ""
}
${layers.database === "mysql" ? "- Keep the MySQL runtime account limited to application reads/writes. Set `MIGRATION_DATABASE_URL` for the same database only in the administrative migration process; provisioning and migration callbacks use that connection and close it afterward. If unset, explicit migration commands require DDL privileges on the configured account.\n" : ""}
\`strata start\` does not migrate when \`APP_ENV=production\`. Run \`bun run db:migrate\` as a deploy step. \`GET /health\` is 200 when \`notes\` is readable (including zero rows) and configured dependencies are available; it returns only \`ok\` or \`degraded\` without authentication or tenant selection, and 503 when a dependency or schema check fails. Use it for readiness, not process liveness. Redis jobs need a worker: \`bun run queue:work\` (requires \`REDIS_URL\`).
`;
}

export { renderApiDocs, renderReadme };
