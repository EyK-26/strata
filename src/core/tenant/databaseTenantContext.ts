import db from "../../db/connection";

async function runWithMigrationBypass<T>(callback: () => T | Promise<T>): Promise<T> {
  await db`SELECT set_config('app.bypass_rls', 'true', false)`;

  try {
    return await callback();
  } finally {
    await db`SELECT set_config('app.bypass_rls', 'false', false)`;
  }
}

export { runWithMigrationBypass };
