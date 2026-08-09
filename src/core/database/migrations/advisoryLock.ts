const MIGRATION_LOCK_KEY = 42_424_242;

type LockableDatabase = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
};

async function withMigrationLock<T>(
  db: LockableDatabase,
  callback: () => Promise<T>,
  lockKey = MIGRATION_LOCK_KEY,
): Promise<T> {
  await db.unsafe("SELECT pg_advisory_lock($1)", [lockKey]);

  try {
    return await callback();
  } finally {
    await db.unsafe("SELECT pg_advisory_unlock($1)", [lockKey]);
  }
}

export { MIGRATION_LOCK_KEY, withMigrationLock };
