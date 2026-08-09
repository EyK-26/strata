import db from "../connection";

const MIGRATION_LOCK_KEY = 42_424_242;

async function withMigrationLock<T>(callback: () => Promise<T>): Promise<T> {
  await db`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;

  try {
    return await callback();
  } finally {
    await db`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
}

export { MIGRATION_LOCK_KEY, withMigrationLock };
