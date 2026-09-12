import {
  authNeedsUsers,
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  DOCKER_SERVICE_LABELS,
  type DockerServiceName,
  type GenerateOptions,
  neededDockerServices,
  needsFrontendBuild,
  needsRedis,
  type StarterLayers,
  selectedDockerServices,
} from "./types.ts";

function envFlag(value: boolean): string {
  return value ? "true" : "false";
}

function appDatabaseName(projectName: string): string {
  return projectName.replace(/[^A-Za-z0-9_]/g, "_");
}

function defaultDatabaseUrl(layers: StarterLayers, projectName: string): string {
  if (layers.database === "sqlite") {
    return "sqlite:./storage/app.sqlite";
  }
  const database = appDatabaseName(projectName);
  if (layers.database === "mysql") {
    return `mysql://root:dev-mysql-change-me@localhost:3306/${database}`;
  }
  return `postgresql://postgres:dev-postgres-change-me@localhost:5432/${database}`;
}

function renderEnvExample(projectName: string, layers: StarterLayers): string {
  const lines = [
    `APP_NAME=${projectName}`,
    `APP_KEY_PREFIX=${projectName}`,
    "APP_ENV=local",
    "PORT=3000",
    "APP_URL=http://localhost:3000",
    `DATABASE_URL=${defaultDatabaseUrl(layers, projectName)}`,
    ...(layers.database === "sqlite"
      ? []
      : [
          "# Optional. Migrate and boot against a different database than DATABASE_URL.",
          "# APP_DATABASE_URL=",
        ]),
    `DB_CONNECTION=${layers.database === "postgres" ? "pgsql" : layers.database}`,
    `FRONTEND_MODE=${layers.frontend}`,
    `SPA_PREFIX=${layers.spaPrefix}`,
    `TENANCY_DRIVER=${layers.tenancy}`,
    `CACHE_DRIVER=${layers.cache}`,
    `QUEUE_DRIVER=${layers.queue}`,
    `MAIL_DRIVER=${layers.mail}`,
    `AUTH_DEV_HEADERS=${envFlag(layers.auth === "headers")}`,
  ];

  lines.push("APP_DEBUG=false");
  lines.push("FEATURE_PUBLIC_READS=false");
  lines.push("FEATURE_SIEM_EXPORT=false");
  lines.push("FEATURE_REGISTRATION=true");
  lines.push("FEATURE_SAML=false");
  lines.push("# SAML_IDP_SSO_URL=");
  lines.push("# SAML_IDP_CERT=");
  lines.push("# SAML_SP_ENTITY_ID=");
  lines.push("# SAML_ACS_URL=");
  lines.push("# SAML_IDP_ISSUER=");
  lines.push("# SAML_WANT_RESPONSE_SIGNED=");
  lines.push("# SAML_DISABLE_REQUESTED_AUTHN_CONTEXT=");

  if (needsRedis(layers)) {
    lines.push("REDIS_PASSWORD=dev-redis-change-me");
    lines.push("REDIS_URL=redis://:dev-redis-change-me@127.0.0.1:6379");
  } else {
    lines.push("# REDIS_PASSWORD=");
    lines.push("# REDIS_URL=redis://127.0.0.1:6379");
  }

  if (
    authUsesCookie(layers.auth) ||
    layers.frontend === "server-htmx" ||
    layers.frontend === "hybrid"
  ) {
    lines.push("SESSION_SECRET=dev-session-secret-change-me-please-32ch");
  } else {
    lines.push("# SESSION_SECRET=");
  }

  if (authUsesJwt(layers.auth)) {
    lines.push("JWT_SECRET=dev-jwt-secret-change-me-please-32chars");
    lines.push("JWT_TTL_SECONDS=3600");
  } else {
    lines.push("# JWT_SECRET=");
  }

  if (authUsesToken(layers.auth)) {
    lines.push("FEATURE_API_TOKENS=true");
    lines.push("TOKEN_HASH_PEPPER=dev-token-pepper-change-me");
    lines.push("API_TOKEN_DEFAULT_EXPIRY_DAYS=30");
  } else {
    lines.push("# FEATURE_API_TOKENS=false");
  }

  lines.push(`FEATURE_MFA=${envFlag(layers.extras.mfa)}`);
  if (layers.extras.mfa) {
    lines.push(
      "KMS_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
  } else {
    lines.push("# KMS_ENCRYPTION_KEY=");
  }
  lines.push(`FEATURE_EMAIL_VERIFICATION=${envFlag(layers.extras.emailVerification)}`);

  if (layers.extras.metrics) {
    lines.push("METRICS_TOKEN=dev-metrics-token-change-me");
  } else {
    lines.push("# METRICS_TOKEN=");
  }

  if (layers.extras.scim) {
    lines.push("FEATURE_SCIM=true");
    lines.push("SCIM_BEARER_TOKEN=dev-scim-token-change-me");
    lines.push("# SCIM_TENANT_TOKENS=1:token-a");
  } else {
    lines.push("# FEATURE_SCIM=false");
    lines.push("# SCIM_BEARER_TOKEN=");
  }

  if (layers.database === "mysql") {
    lines.push(`MYSQL_URL=${defaultDatabaseUrl(layers, projectName)}`);
  }

  if (layers.mail === "smtp") {
    lines.push("MAIL_HOST=localhost");
    lines.push("MAIL_PORT=1025");
    lines.push(`MAIL_FROM=noreply@${projectName}.local`);
    lines.push("MAIL_SECURE=false");
  } else {
    lines.push("# MAIL_HOST=");
    lines.push("# MAIL_FROM=");
  }

  lines.push(
    "# Behind a reverse proxy, trust X-Forwarded-For (rightmost public hop) for throttles and session IPs.",
  );
  lines.push("# TRUST_FORWARDED_FOR=true");
  return `${lines.join("\n")}\n`;
}

function renderDockerCompose(projectName: string, layers: StarterLayers): string | null {
  const selected = selectedDockerServices(layers);
  if (selected.length === 0) {
    return null;
  }

  const selectedSet = new Set(selected);
  const services: string[] = [];

  if (selectedSet.has("postgres")) {
    const database = appDatabaseName(projectName);
    services.push(`  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: dev-postgres-change-me
      POSTGRES_DB: ${database}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data`);
  }

  if (selectedSet.has("mysql")) {
    const database = appDatabaseName(projectName);
    services.push(`  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: dev-mysql-change-me
      MYSQL_DATABASE: ${database}
    ports:
      - "127.0.0.1:3306:3306"
    volumes:
      - mysqldata:/var/lib/mysql`);
  }

  if (selectedSet.has("adminer")) {
    const server = selectedSet.has("mysql") ? "mysql" : "postgres";
    services.push(`  adminer:
    image: adminer:5.4.2
    profiles:
      - debug
    environment:
      ADMINER_DEFAULT_SERVER: ${server}
    depends_on:
      - ${server}
    ports:
      - "127.0.0.1:8080:8080"`);
  }

  if (selectedSet.has("redis")) {
    services.push(`  redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "\${REDIS_PASSWORD:-dev-redis-change-me}"]
    ports:
      - "127.0.0.1:6379:6379"`);
  }

  if (selectedSet.has("mailpit")) {
    services.push(`  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "127.0.0.1:1025:1025"
      - "127.0.0.1:8025:8025"`);
  }

  const volumes: string[] = [];
  if (selectedSet.has("postgres")) {
    volumes.push("  pgdata:");
  }
  if (selectedSet.has("mysql")) {
    volumes.push("  mysqldata:");
  }

  return `services:
${services.join("\n\n")}
${volumes.length > 0 ? `\nvolumes:\n${volumes.join("\n")}\n` : ""}`;
}

function renderGitignore(): string {
  return `node_modules
.env
.env.local
dist
frontend/dist
storage/*.sqlite
storage/*.sqlite-journal
storage/*.sqlite-wal
storage/*.sqlite-shm
coverage
*.tsbuildinfo
`;
}

function renderDockerfile(layers: StarterLayers): string {
  const frontend = needsFrontendBuild(layers.frontend);
  const lines = [
    '# Production image. Build once, run with env from your platform; see README "Deploy".',
    "FROM oven/bun:1.4 AS deps",
    "WORKDIR /app",
    "COPY package.json bun.lock ./",
    "RUN bun install --frozen-lockfile --production",
    "",
  ];
  if (frontend) {
    lines.push(
      "FROM oven/bun:1.4 AS frontend",
      "WORKDIR /app/frontend",
      "COPY frontend/package.json frontend/bun.lock ./",
      "RUN bun install --frozen-lockfile",
      "COPY frontend/ ./",
      "RUN bun run build",
      "",
    );
  }
  lines.push(
    "FROM oven/bun:1.4-slim AS runtime",
    "WORKDIR /app",
    "ENV APP_ENV=production",
    "ENV AUTH_DEV_HEADERS=false",
    "ENV PORT=3000",
    "COPY --from=deps /app/node_modules ./node_modules",
    "COPY . .",
  );
  if (frontend) {
    lines.push("COPY --from=frontend /app/frontend/dist ./frontend/dist");
  }
  lines.push("RUN mkdir -p storage && chown -R bun:bun /app", "USER bun", "EXPOSE 3000");
  if (layers.database === "sqlite") {
    lines.push(
      "# SQLite lives in storage/; mount a volume there or the data dies with the container.",
      'VOLUME ["/app/storage"]',
    );
  }
  lines.push(
    'HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["bun", "-e", "fetch(\'http://127.0.0.1:\' + process.env.PORT + \'/health\').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]',
    'CMD ["bun", "run", "start"]',
  );
  return `${lines.join("\n")}\n`;
}

function renderDockerignore(layers: StarterLayers): string {
  const lines = [
    ".git",
    "node_modules",
    ".env",
    ".env.*",
    "!.env.example",
    "storage/*.sqlite",
    "storage/*.sqlite-journal",
    "storage/*.sqlite-wal",
    "storage/*.sqlite-shm",
    "coverage",
    "docker-compose.yml",
  ];
  if (needsFrontendBuild(layers.frontend)) {
    lines.push("frontend/node_modules", "frontend/dist");
  }
  return `${lines.join("\n")}\n`;
}

function renderPackageJson(
  projectName: string,
  options: { workspaceDependencies?: boolean; layers?: StarterLayers } = {},
): string {
  const coreDeps: Record<string, string> = options.workspaceDependencies
    ? {
        "@getstrata/bootstrap": "workspace:*",
        "@getstrata/cli": "workspace:*",
        "@getstrata/core": "workspace:*",
      }
    : {
        "@getstrata/bootstrap": "^1.1.0",
        "@getstrata/cli": "^1.1.0",
        "@getstrata/core": "^1.1.0",
      };
  coreDeps.eta = "^4.6.0";
  if (options.layers?.database === "mysql") {
    coreDeps.mysql2 = "^3.24.3";
  }

  const scripts: Record<string, string> = {
    dev: "strata dev",
    start: "strata start",
    "db:migrate": "strata migrate",
    "db:fresh": "strata migrate:fresh",
    check: "tsc --noEmit",
  };
  if (options.layers && needsFrontendBuild(options.layers.frontend)) {
    scripts["frontend:install"] = "cd frontend && bun install";
    scripts["frontend:build"] = "cd frontend && bun run build";
    scripts["frontend:dev"] = "cd frontend && bun run dev";
  }

  return `${JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts,
      dependencies: coreDeps,
      devDependencies: {
        "@types/bun": "^1.4.0",
        typescript: "^5.9.2",
      },
    },
    null,
    2,
  )}\n`;
}

function renderLayersManifest(projectName: string, layers: StarterLayers): string {
  return `${JSON.stringify(
    {
      name: projectName,
      generatedBy: "create-strata",
      layers: {
        frontend: layers.frontend,
        database: layers.database,
        auth: layers.auth,
        tenancy: layers.tenancy,
        cache: layers.cache,
        queue: layers.queue,
        mail: layers.mail,
        spaPrefix: layers.spaPrefix,
        extras: layers.extras,
        docker: layers.docker,
      },
      notes:
        "Generated by create-strata. Change layers later with flags or by editing env and bootstrap files.",
    },
    null,
    2,
  )}\n`;
}

function localEnvVars(services: DockerServiceName[]): string[] {
  const vars: string[] = [];
  for (const name of services) {
    if (name === "postgres" || name === "mysql") {
      vars.push("DATABASE_URL");
    } else if (name === "redis") {
      vars.push("REDIS_URL");
    } else if (name === "mailpit") {
      vars.push("MAIL_HOST");
    }
  }
  return [...new Set(vars)];
}

function renderSupportingToolsReadme(layers: StarterLayers): string {
  const needed = neededDockerServices(layers);
  if (needed.length === 0) {
    return "";
  }

  const dockerOn = selectedDockerServices(layers);
  const dockerSet = new Set(dockerOn);
  const localOn = needed.filter((name) => !dockerSet.has(name));
  const lines = ["## Supporting tools", ""];

  if (dockerOn.length > 0) {
    const names = dockerOn.map((name) => DOCKER_SERVICE_LABELS[name]).join(", ");
    lines.push(
      `Docker Compose includes ${names}.`,
      "",
      "```bash",
      "docker compose up -d",
      "```",
      "",
    );
    if (dockerSet.has("adminer")) {
      const mysql = layers.database === "mysql";
      const system = mysql ? "MySQL" : "PostgreSQL";
      const server = mysql ? "mysql" : "postgres";
      const username = mysql ? "root" : "postgres";
      const password = mysql ? "root" : "postgres";
      lines.push(
        `Adminer: http://localhost:8080 (${system}, server \`${server}\`, username \`${username}\`, password \`${password}\`).`,
        "",
      );
    }
  }

  if (localOn.length > 0) {
    const names = localOn.map((name) => DOCKER_SERVICE_LABELS[name]).join(", ");
    const envVars = localEnvVars(localOn)
      .map((name) => `\`${name}\``)
      .join(", ");
    lines.push(
      `Use local installs for ${names}. Point ${envVars} in \`.env\` at services on this machine.`,
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Written per layer so it can only list routes this app actually serves.
 * A static template drifts the moment the auth stack changes.
 */
function renderApiDocs(projectName: string, layers: StarterLayers): string {
  const rows = ["| Method | Path | Notes |", "| --- | --- | --- |"];
  rows.push(
    "| `GET` | `/health` | Plain text `ok` (200), or `degraded` (503) until a notes row is readable under the request tenant. Docker HEALTHCHECK uses this path. |",
    '| `GET` | `/ready` | JSON from the framework: `{"status":"ready","checks":{"database":"ok","redis":"skipped"}}` (200) or `not_ready` (503). `redis` is `ok` or `error` when `REDIS_URL` is set and `skipped` otherwise. It does not check the schema, so use `/health` as the deploy gate. |',
  );
  rows.push("| `GET` | `/` | Welcome page. Restyle or replace it. |");

  if (authUsesToken(layers.auth)) {
    rows.push(
      "| `POST` | `/api/v1/auth/login` | `{ email, password }` returns `{ token }`. Requires `GET /api/v1/auth/csrf` then `X-CSRF-Token`. |",
      "| `POST` | `/api/v1/auth/register` | Creates a user and returns a token. |",
      "| `GET` | `/api/v1/auth/me` | Requires `Authorization: Bearer <token>`. |",
    );
  }
  if (authUsesJwt(layers.auth)) {
    rows.push(
      "| `POST` | `/api/auth/token` | Mints a short-lived JWT. Not an HTML session. Requires CSRF like JSON login. |",
    );
  }
  if (authNeedsUsers(layers.auth)) {
    rows.push(
      "| `POST` | `/api/v1/auth/forgot-password` | Sends a signed reset link through the mail driver. |",
      "| `POST` | `/api/v1/auth/reset-password` | Consumes the signed link. |",
      "| `GET` | `/api/user` | Current user for the active guard. |",
    );
  }
  if (layers.extras.metrics) {
    rows.push(
      "| `GET` | `/metrics` | Prometheus text. Production requires `Authorization: Bearer <METRICS_TOKEN>`. |",
    );
  }

  const authNote =
    layers.auth === "headers"
      ? `Auth is \`headers\`. Send \`x-authenticated-user-id\` (and optional \`x-authenticated-user-role\`) for local work and tests. There are no login endpoints and no \`users\` table. Production must set \`AUTH_DEV_HEADERS=false\`, which turns those headers off and leaves you without a guard, so pick another auth layer before you ship.`
      : authUsesToken(layers.auth)
        ? `Sign in with \`GET /api/v1/auth/csrf\` then \`POST /api/v1/auth/login\` (send \`X-CSRF-Token\`), then send \`Authorization: Bearer <token>\` on every request. Tokens are stored hashed in \`api_tokens\` and expire after \`API_TOKEN_DEFAULT_EXPIRY_DAYS\` (30 in \`.env.example\`). The response includes \`expires_at\`.`
        : `Mint a JWT with \`POST /api/auth/token\`, then send \`Authorization: Bearer <jwt>\`. JWTs expire; re-mint rather than refreshing in place.`;

  return `# ${projectName} API

\`FRONTEND_MODE=${layers.frontend}\`. ${
    layers.frontend === "api"
      ? "No server-rendered views beyond the welcome page and no SPA assets."
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

function renderReadmeIntro(
  projectName: string,
  options: Pick<GenerateOptions, "inRepoExample" | "dogfood">,
): string {
  if (options.dogfood) {
    return `# ${projectName}

This in-repo app is Strata dogfood for internal end-to-end testing (migrate, seed, boot, OpenAPI, smoke). It is not a product. Start a product app with \`bunx create-strata\`.
`;
  }
  if (options.inRepoExample) {
    return `# ${projectName}

This in-repo app is a generated sibling layer map. It is not a product and it is not CI dogfood. CI dogfood is \`apps/hiroapp\`. Start a product app with \`bunx create-strata\`.
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
    next.push("docker compose up -d");
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
This file is the map for this app. Framework guides: [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md), [Auth](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [Starter](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md).

## Run it

\`\`\`bash
${next.join("\n")}
\`\`\`

Open http://localhost:3000. Health check: \`GET /health\`.

${renderSupportingToolsReadme(layers)}${
  layers.auth !== "headers"
    ? `
Seeded login (password \`StrataDemo!ChangeMe\`):

- \`demo@example.com\` (member)
- \`admin@example.test\` (admin)
`
    : `
Header auth is on for local use. Send \`x-authenticated-user-id\` (and optional \`x-authenticated-user-role\`). Production must set \`AUTH_DEV_HEADERS=false\`.
`
}${
  authUsesCookie(layers.auth)
    ? `
HTML auth kit (restyle \`views/\` and \`public/assets/site.css\`):

- Welcome: \`/\`
- Sign in: \`/login\`
- Register: \`/register\`
- Forgot password: \`/forgot-password\`
- Reset password: signed \`/reset-password\` (mail log when \`MAIL_DRIVER=log\`)
${layers.extras.emailVerification ? "- Verify email: `/email/verify`\n" : ""}${layers.extras.mfa ? "- MFA challenge: `/login/mfa` and setup: `/account/mfa`\n" : ""}
Cookie name is \`strata_session\`. Forms send CSRF as \`_token\`.
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

The app uses the database named in \`DATABASE_URL\` and creates it on first migrate when the connection user may. Set \`APP_DATABASE_URL\` only when migrations and the app should target a different database than \`DATABASE_URL\`.
`
}
## Deploy

\`Dockerfile\` builds a production image from the committed \`bun.lock\` (run \`bun install\` once and commit the lockfile).${
    needsFrontendBuild(layers.frontend) ? " The React frontend is built inside the image." : ""
  }

\`\`\`bash
docker build -t ${projectName} .
docker run --rm -p 3000:3000 --env-file .env.production ${projectName}
\`\`\`

Migrations are a deploy step, not a boot step: run \`docker run --rm --env-file .env.production ${projectName} bun run db:migrate\` before the new version takes traffic.${
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
- Set \`FEATURE_PUBLIC_READS=false\`. ${
    layers.frontend === "api"
      ? "This app already ships `false`."
      : "This app ships `true` so the local welcome page reads without a login. Production requires `false`."
  }
- Cross-origin browser calls are off in production until you set \`CORS_ALLOWED_ORIGINS\` to explicit origins. A \`*\` entry is rejected. Non-browser clients are unaffected.
- Behind a reverse proxy or load balancer, set \`TRUST_FORWARDED_FOR=true\` so throttles and session records see the client address instead of the proxy. Only the rightmost public hop of \`X-Forwarded-For\` is trusted.
${authUsesCookie(layers.auth) ? "- Set `SESSION_SECRET` to 32+ characters.\n" : ""}${authUsesToken(layers.auth) ? "- Set `TOKEN_HASH_PEPPER`.\n" : ""}${layers.extras.scim ? "- Set `SCIM_BEARER_TOKEN`.\n" : ""}${layers.extras.metrics ? "- Set `METRICS_TOKEN`.\n" : ""}
\`strata start\` does not migrate when \`APP_ENV=production\`. Run \`bun run db:migrate\` as a deploy step. \`GET /health\` answers 503 until a notes row is readable, so a fresh deploy stays out of rotation until it is migrated.
`;
}

export {
  appDatabaseName,
  defaultDatabaseUrl,
  renderApiDocs,
  renderDockerCompose,
  renderDockerfile,
  renderDockerignore,
  renderEnvExample,
  renderGitignore,
  renderLayersManifest,
  renderPackageJson,
  renderReadme,
};
