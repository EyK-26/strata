import {
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  isHiringRecipe,
  needsRedis,
  type StarterLayers,
} from "./types.ts";

function envFlag(value: boolean): string {
  return value ? "true" : "false";
}

function defaultDatabaseUrl(layers: StarterLayers, projectName: string): string {
  if (layers.database === "sqlite") {
    return "sqlite:./storage/app.sqlite";
  }
  if (layers.database === "mysql") {
    return `mysql://root:root@localhost:3306/${projectName}`;
  }
  return `postgresql://postgres:postgres@localhost:5432/${projectName}`;
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
  } else {
    lines.push("# FEATURE_SCIM=false");
    lines.push("# SCIM_BEARER_TOKEN=");
  }

  if (layers.extras.sqliteKiosk) {
    lines.push("KIOSK_SQLITE=./storage/kiosk.sqlite");
  } else {
    lines.push("# KIOSK_SQLITE=./storage/kiosk.sqlite");
  }

  if (layers.extras.mysqlMirror || layers.database === "mysql") {
    lines.push(`MYSQL_URL=mysql://root:root@localhost:3306/${projectName}_board`);
  } else {
    lines.push("# MYSQL_URL=");
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
  const services: string[] = [];

  if (layers.database === "postgres") {
    services.push(`  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${projectName}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data`);
  }

  if (layers.database === "mysql" || layers.extras.mysqlMirror) {
    const dbName = layers.database === "mysql" ? projectName : `${projectName}_board`;
    services.push(`  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: ${dbName}
    ports:
      - "3306:3306"
    volumes:
      - mysqldata:/var/lib/mysql`);
  }

  if (needsRedis(layers)) {
    services.push(`  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"`);
  }

  if (layers.mail === "smtp") {
    services.push(`  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"
      - "8025:8025"`);
  }

  if (services.length === 0) {
    return null;
  }

  const volumes: string[] = [];
  if (layers.database === "postgres") {
    volumes.push("  pgdata:");
  }
  if (layers.database === "mysql" || layers.extras.mysqlMirror) {
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

function renderPackageJson(projectName: string): string {
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
      dependencies: {
        "@getstrata/bootstrap": "^0.4.2",
        "@getstrata/cli": "^0.2.0",
        "@getstrata/core": "^0.7.3",
      },
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
      kit: layers.kit,
      recipe: isHiringRecipe(layers.kit)
        ? `hiroapp_build_from_starter_kit_x_level_${layers.scale}`
        : null,
      scale: layers.scale,
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
      },
      hiroappEquivalent: false,
      notes: isHiringRecipe(layers.kit)
        ? "Hiring-shaped starter. Not a copy of apps/hiroapp. See docs/STARTER.md."
        : "Generated by create-strata. HiroApp itself is not regenerated from this kit.",
    },
    null,
    2,
  )}\n`;
}

function renderReadme(projectName: string, layers: StarterLayers): string {
  const hiring = isHiringRecipe(layers.kit);
  const docker = renderDockerCompose(projectName, layers);
  const next = [`cd ${projectName}`, "cp .env.example .env"];
  if (docker) {
    next.push("docker compose up -d");
  }
  next.push("bun install", "strata migrate", "strata dev");

  const extras = Object.entries(layers.extras)
    .filter(([, on]) => on)
    .map(([key]) => key);

  return `# ${projectName}

Strata app generated by \`create-strata\` (\`${layers.kit}\`).

## Layers

| Layer | Choice |
|-------|--------|
| Scale | ${layers.scale} |
| Frontend | \`${layers.frontend}\` |
| Database | \`${layers.database}\` |
| Auth | \`${layers.auth}\` |
| Tenancy | \`${layers.tenancy}\` |
| Cache | \`${layers.cache}\` |
| Queue | \`${layers.queue}\` |
| Mail | \`${layers.mail}\` |
| SPA prefix | \`${layers.spaPrefix}\` |
${extras.length > 0 ? `| Corporate extras | ${extras.join(", ")} |\n` : ""}
This file is the map for this app. Framework guides: [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md), [Auth](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [Starter kits](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md).

## Run it

\`\`\`bash
${next.join("\n")}
\`\`\`

Open http://localhost:3000. Health check: \`GET /health\`.
${
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
HTML sign-in lives at \`/login\` (cookie session + CSRF when \`FRONTEND_MODE\` is \`server-htmx\` or \`hybrid\`).
`
    : ""
}${
  authUsesToken(layers.auth)
    ? `
Opaque token login: \`POST /api/v1/auth/login\` with \`{ "email", "password" }\`. Send \`Authorization: Bearer\`.
`
    : ""
}${
  authUsesJwt(layers.auth)
    ? `
JWT mint: \`POST /api/auth/token\` with email and password. Short-lived. Not a portal session.
`
    : ""
}${
  hiring
    ? `
## Hiring recipe

This kit is a **hiring-shaped** skeleton (\`SPA_PREFIX=${layers.spaPrefix}\`, public \`/careers\`). It is not HiroApp.

HiroApp (\`apps/hiroapp\`) already has departments, applications, interviews, offers, MFA, SCIM, and sidecars. Do not regenerate that app from this starter. Use this recipe for a new hiring product, or copy patterns from HiroApp.

See \`apps/hiroapp/starter-layers.json\` in the Strata repo for the retroactive layer map.
`
    : ""
}
## Production

\`createApp\` calls \`assertProductionSecrets()\` when \`APP_ENV=production\`. Set real secrets before you ship. Cookie HTML apps need \`SESSION_SECRET\` (32+ characters). Token apps need \`TOKEN_HASH_PEPPER\`. Set \`AUTH_DEV_HEADERS=false\`.
`;
}

export {
  defaultDatabaseUrl,
  renderDockerCompose,
  renderEnvExample,
  renderGitignore,
  renderLayersManifest,
  renderPackageJson,
  renderReadme,
};
