function resolveHiroappDatabaseUrl(): string {
  const explicit = process.env.HIROAPP_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const base = process.env.DATABASE_URL?.trim();
  if (base) {
    try {
      const url = new URL(base);
      url.pathname = "/hiroapp_test";
      return url.toString();
    } catch {
      return base;
    }
  }

  return "postgresql://postgres:postgres@127.0.0.1:54329/hiroapp_test";
}

function adminCandidateUrls(url: string): string[] {
  const names = ["postgres", "template1"];
  try {
    const current = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    if (current && !names.includes(current)) {
      names.push(current);
    }
  } catch {
    // keep the built-in admin databases
  }
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
    : new Error("Could not open an admin connection to create the HiroApp database.");
}

async function ensureHiroappDatabase(url = resolveHiroappDatabaseUrl()): Promise<string> {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("HiroApp DATABASE_URL is missing a database name.");
  }

  const identifier = database.replace(/[^A-Za-z0-9_]/g, "");
  if (identifier !== database) {
    throw new Error(`Refusing to create HiroApp database with an unsafe name: ${database}`);
  }

  const adminSql = await openAdminConnection(url);
  try {
    const rows = await adminSql`
      SELECT 1 AS ok FROM pg_database WHERE datname = ${database}
    `;
    if (rows.length === 0) {
      await adminSql.unsafe(`CREATE DATABASE ${identifier}`);
    }
  } finally {
    await adminSql.close();
  }

  process.env.DATABASE_URL = url;
  process.env.HIROAPP_DATABASE_URL = url;
  return url;
}

export { ensureHiroappDatabase, resolveHiroappDatabaseUrl };
