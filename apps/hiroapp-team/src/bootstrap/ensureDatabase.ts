const APP_DATABASE = "hiroapp_team_test";

function resolveAppDatabaseUrl(): string {
  const explicit = process.env.APP_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const base =
    process.env.DATABASE_URL?.trim() ||
    "postgresql://postgres:postgres@localhost:5432/hiroapp_team_test";
  try {
    const url = new URL(base);
    url.pathname = `/${APP_DATABASE}`;
    return url.toString();
  } catch {
    return base;
  }
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
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name) {
    throw new Error("DATABASE_URL is missing a database name.");
  }

  const identifier = name.replace(/[^A-Za-z0-9_]/g, "");
  if (identifier !== name) {
    throw new Error(`Refusing to create a database with an unsafe name: ${name}`);
  }

  const adminSql = await openAdminConnection(url);
  try {
    const rows = await adminSql`
      SELECT 1 AS ok FROM pg_database WHERE datname = ${name}
    `;
    if (rows.length === 0) {
      await adminSql.unsafe(`CREATE DATABASE ${identifier}`);
    }
  } finally {
    await adminSql.close();
  }

  process.env.DATABASE_URL = url;
  process.env.APP_DATABASE_URL = url;
  return url;
}
