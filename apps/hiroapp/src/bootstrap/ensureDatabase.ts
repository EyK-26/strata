const DEFAULT_DATABASE_URL =
  "postgresql://strata_app:dev-strata-app-change-me@localhost:5432/hiroapp";

/**
 * The database name comes from DATABASE_URL. Set APP_DATABASE_URL to point
 * migrations and the app at a different database than DATABASE_URL.
 */
function resolveAppDatabaseUrl(): string {
  const explicit = process.env.APP_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/** Reject anything we would have to quote before interpolating into DDL. */
function safeDatabaseName(url: string): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`);
  }
  if (!name) {
    throw new Error("DATABASE_URL is missing a database name.");
  }
  if (name.replace(/[^A-Za-z0-9_]/g, "") !== name) {
    throw new Error(`Refusing to create a database with an unsafe name: ${name}`);
  }
  return name;
}

function adminCandidateUrls(url: string): string[] {
  const names = ["postgres", "template1"];
  try {
    const current = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    if (current && !names.includes(current)) {
      names.push(current);
    }
  } catch {}
  return names.map((name) => {
    const admin = new URL(url);
    admin.pathname = `/${name}`;
    return admin.toString();
  });
}

async function openAdminConnection(url: string): Promise<Bun.SQL> {
  let lastError: unknown;
  for (const candidate of adminCandidateUrls(url)) {
    const adminSql = new Bun.SQL(candidate);
    try {
      await adminSql`SELECT 1`;
      return adminSql;
    } catch (error) {
      lastError = error;
      await adminSql.close().catch(() => undefined);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not open an admin connection to create the app database.");
}

export async function ensureAppDatabase(): Promise<string> {
  const url = resolveAppDatabaseUrl();
  const name = safeDatabaseName(url);

  const adminSql = await openAdminConnection(url);
  try {
    const rows = await adminSql`
      SELECT 1 AS ok FROM pg_database WHERE datname = ${name}
    `;
    if (rows.length === 0) {
      await adminSql.unsafe(`CREATE DATABASE ${name}`);
    }
  } finally {
    await adminSql.close();
  }

  process.env.DATABASE_URL = url;
  return url;
}
