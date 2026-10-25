import assert from "node:assert/strict";

const WORKER_ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "APP_DATABASE_URL",
  "RLS_TEST_DATABASE_URL",
  "REDIS_URL",
  "MYSQL_URL",
  "MYSQL_OBSERVABILITY_ADMIN_URL",
  "POSTGRES_PASSWORD",
  "STRATA_APP_PASSWORD",
] as const;

function testWorkerEnvironment(value: unknown, id: string): Record<string, string> {
  assert.ok(value && typeof value === "object" && "version" in value && value.version === 1);
  assert.ok("workers" in value && value.workers && typeof value.workers === "object");
  assert.match(id, /^[1-4]$/);
  const worker: unknown = Reflect.get(value.workers, id);
  assert.ok(worker && typeof worker === "object", `Missing isolated test worker ${id}`);
  const result: Record<string, string> = {};
  for (const key of WORKER_ENVIRONMENT_KEYS) {
    const url: unknown = Reflect.get(worker, key);
    const password = key === "POSTGRES_PASSWORD" || key === "STRATA_APP_PASSWORD";
    if (password && url === undefined) continue;
    assert.ok(
      typeof url === "string" && (password || url.length > 0),
      `Missing worker ${id} ${key}`,
    );
    result[key] = url;
  }
  return result;
}

export { testWorkerEnvironment, WORKER_ENVIRONMENT_KEYS };
