import { SQL } from "bun";

export type SqlClient = InstanceType<typeof SQL>;

let sql: SqlClient | null = null;

export function getSql(): SqlClient {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    sql = new SQL({ url, max: 5 });
  }
  return sql;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getSql()`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  if (sql) {
    await sql.close();
    sql = null;
  }
}
