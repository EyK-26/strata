import {
  appDatabaseName,
  GENERATED_MYSQL_ROOT_PASSWORD,
  GENERATED_POSTGRES_SUPERUSER_PASSWORD,
} from "./databaseDefaults.ts";
import { needsFrontendBuild, type StarterLayers, selectedDockerServices } from "./types.ts";

/** Real dependency readiness, bounded by the generated Compose wait command. */
function renderServiceHealthcheck(test: string[]): string {
  return `    healthcheck:
      test: ${JSON.stringify(test)}
      interval: 2s
      timeout: 3s
      retries: 60
      start_period: 5s`;
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
      POSTGRES_PASSWORD: ${GENERATED_POSTGRES_SUPERUSER_PASSWORD}
      POSTGRES_DB: ${database}
${renderServiceHealthcheck(["CMD-SHELL", 'PGPASSWORD="$$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -tAc "SELECT 1" >/dev/null'])}
    ports:
      # Localhost only. Do not publish this port on a production host.
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro`);
  }

  if (selectedSet.has("mysql")) {
    const database = appDatabaseName(projectName);
    services.push(`  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: ${GENERATED_MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${database}
${renderServiceHealthcheck(["CMD-SHELL", 'MYSQL_PWD="$$MYSQL_ROOT_PASSWORD" mysql --protocol=tcp -h 127.0.0.1 -u root -D "$$MYSQL_DATABASE" -N -e "SELECT 1" >/dev/null'])}
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
      ${server}:
        condition: service_healthy
${renderServiceHealthcheck(["CMD", "php", "-r", "exit(@file_get_contents('http://127.0.0.1:8080/') === false ? 1 : 0);"])}
    ports:
      - "127.0.0.1:8080:8080"`);
  }

  if (selectedSet.has("redis")) {
    services.push(`  redis:
    image: redis:7-alpine
    environment:
      REDIS_PASSWORD: "\${REDIS_PASSWORD:-dev-redis-change-me}"
${renderServiceHealthcheck(["CMD-SHELL", 'REDISCLI_AUTH="$$REDIS_PASSWORD" redis-cli --no-auth-warning ping | grep -qx PONG'])}
    command: ["redis-server", "--requirepass", "\${REDIS_PASSWORD:-dev-redis-change-me}"]
    ports:
      - "127.0.0.1:6379:6379"`);
  }

  if (selectedSet.has("mailpit")) {
    services.push(`  mailpit:
    image: axllent/mailpit:latest
${renderServiceHealthcheck(["CMD", "/mailpit", "readyz"])}
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

function renderDockerfile(layers: StarterLayers): string {
  const frontend = needsFrontendBuild(layers.frontend);
  const lines = [
    '# Production image. Build once, run with env from your platform; see README "Deploy".',
    "FROM oven/bun:1.4.3 AS deps",
    "WORKDIR /app",
    "COPY package.json bun.lock ./",
    "RUN bun install --frozen-lockfile --production",
    "",
  ];
  if (frontend) {
    lines.push(
      "FROM oven/bun:1.4.3 AS frontend",
      "WORKDIR /app/frontend",
      "COPY --from=deps /app/node_modules /app/node_modules",
      "ARG SPA_PREFIX",
      "ENV SPA_PREFIX=$SPA_PREFIX",
      "COPY frontend/package.json frontend/bun.lock ./",
      "RUN bun install --frozen-lockfile",
      "COPY frontend/ ./",
      "RUN bun run build",
      "",
    );
  }
  lines.push(
    "FROM oven/bun:1.4.3-slim AS runtime",
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
    "# Readiness: anonymous dependency/schema probe; use a separate process check for liveness.",
    'HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["bun", "-e", "fetch(\'http://127.0.0.1:\' + process.env.PORT + \'/health\').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]',
    'CMD ["bun", "./node_modules/.bin/strata", "start"]',
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

export { renderDockerCompose, renderDockerfile, renderDockerignore };
