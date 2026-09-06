import {
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  DOCKER_SERVICE_LABELS,
  type DockerServiceName,
  neededDockerServices,
  needsRedis,
  type StarterLayers,
  selectedDockerServices,
} from "./types.ts";

function envFlag(value: boolean): string {
  return value ? "true" : "false";
}

function appDatabaseName(projectName: string): string {
  return `${projectName.replace(/[^A-Za-z0-9_]/g, "_")}_test`;
}

function defaultDatabaseUrl(layers: StarterLayers, projectName: string): string {
  if (layers.database === "sqlite") {
    return "sqlite:./storage/app.sqlite";
  }
  const database = appDatabaseName(projectName);
  if (layers.database === "mysql") {
    return `mysql://root:root@localhost:3306/${database}`;
  }
  return `postgresql://postgres:postgres@localhost:5432/${database}`;
}

function renderEnvExample(projectName: string, layers: StarterLayers): string {
  const lines = [
    `APP_NAME=${projectName}`,
    `APP_KEY_PREFIX=${projectName}`,
    "APP_ENV=local",
    "PORT=3000",
    "APP_URL=http://localhost:3000",
    `DATABASE_URL=${defaultDatabaseUrl(layers, projectName)}`,
    `DB_CONNECTION=${layers.database === "postgres" ? "pgsql" : layers.database}`,
    `FRONTEND_MODE=${layers.frontend}`,
    `SPA_PREFIX=${layers.spaPrefix}`,
    `TENANCY_DRIVER=${layers.tenancy}`,
    `CACHE_DRIVER=${layers.cache}`,
    `QUEUE_DRIVER=${layers.queue}`,
    `MAIL_DRIVER=${layers.mail}`,
    `AUTH_DEV_HEADERS=${envFlag(layers.auth === "headers")}`,
    `FEATURE_PUBLIC_READS=${envFlag(layers.frontend !== "api")}`,
  ];

  if (needsRedis(layers)) {
    lines.push("REDIS_URL=redis://127.0.0.1:6379");
  } else {
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
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${database}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data`);
  }

  if (selectedSet.has("mysql")) {
    const database = appDatabaseName(projectName);
    services.push(`  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: ${database}
    ports:
      - "3306:3306"
    volumes:
      - mysqldata:/var/lib/mysql`);
  }

  if (selectedSet.has("redis")) {
    services.push(`  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"`);
  }

  if (selectedSet.has("mailpit")) {
    services.push(`  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"
      - "8025:8025"`);
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
coverage
*.tsbuildinfo
`;
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
        "@getstrata/bootstrap": "^0.4.3",
        "@getstrata/cli": "^0.2.0",
        "@getstrata/core": "^0.7.5",
      };
  if (options.layers?.database === "mysql") {
    coreDeps.mysql2 = "^3.24.3";
  }

  return `${JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "strata dev",
        start: "strata start",
        "db:migrate": "strata migrate",
        "db:fresh": "strata migrate:fresh",
        check: "tsc --noEmit",
      },
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

function renderReadme(projectName: string, layers: StarterLayers): string {
  const docker = renderDockerCompose(projectName, layers);
  const next = [`cd ${projectName}`, "cp .env.example .env"];
  if (docker) {
    next.push("docker compose up -d");
  }
  next.push("bun install", "strata migrate", "strata dev");

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

  return `# ${projectName}

Strata app generated by \`create-strata\`.

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
Seeded login (password \`password\`):

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
JWT mint: \`POST /api/auth/token\` with email and password. Short-lived. Not a portal session.
`
    : ""
}${
  layers.extras.metrics
    ? `
Prometheus scrape: \`GET /metrics\`. Production requires \`Authorization: Bearer <METRICS_TOKEN>\`.
`
    : ""
}
## Production

\`createApp\` calls \`assertProductionSecrets()\` when \`APP_ENV=production\`. Set real secrets before you ship. Cookie HTML apps need \`SESSION_SECRET\` (32+ characters). Token apps need \`TOKEN_HASH_PEPPER\`. Set \`AUTH_DEV_HEADERS=false\`.
`;
}

export {
  appDatabaseName,
  defaultDatabaseUrl,
  renderDockerCompose,
  renderEnvExample,
  renderGitignore,
  renderLayersManifest,
  renderPackageJson,
  renderReadme,
};
