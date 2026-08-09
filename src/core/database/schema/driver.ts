type DatabaseDriver = "pgsql" | "mysql" | "sqlite";

interface ResolveDatabaseDriverOptions {
  url?: string;
  connection?: string;
}

function normalizeConnectionName(connection: string): DatabaseDriver {
  const normalized = connection.trim().toLowerCase();

  if (normalized === "pgsql" || normalized === "postgres" || normalized === "postgresql") {
    return "pgsql";
  }

  if (normalized === "mysql" || normalized === "mariadb") {
    return "mysql";
  }

  if (normalized === "sqlite") {
    return "sqlite";
  }

  throw new Error(`Unsupported DB_CONNECTION: ${connection}`);
}

function resolveDriverFromUrl(url: string): DatabaseDriver | null {
  const normalized = url.trim().toLowerCase();

  if (
    normalized.startsWith("postgres://") ||
    normalized.startsWith("postgresql://") ||
    normalized.startsWith("postgres:")
  ) {
    return "pgsql";
  }

  if (normalized.startsWith("mysql://") || normalized.startsWith("mysql:")) {
    return "mysql";
  }

  if (normalized.startsWith("sqlite:")) {
    return "sqlite";
  }

  return null;
}

function resolveDatabaseDriver(options: ResolveDatabaseDriverOptions = {}): DatabaseDriver {
  const connection = options.connection ?? process.env.DB_CONNECTION;
  if (connection) {
    return normalizeConnectionName(connection);
  }

  const url = options.url ?? process.env.DATABASE_URL ?? "";
  const fromUrl = resolveDriverFromUrl(url);
  if (fromUrl) {
    return fromUrl;
  }

  return "pgsql";
}

export type { DatabaseDriver, ResolveDatabaseDriverOptions };
export { resolveDatabaseDriver };
