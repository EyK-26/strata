import { SQL } from "bun";
import type { AppDependencies } from "../../src/bootstrap/contracts";
import type { DatabaseConnection as CoreDatabaseConnection } from "../../src/core/database/baseRepository.ts";
import { bindDatabaseConnection } from "../../src/core/database/bindConnection.ts";
import { resetBoundDatabaseConnection } from "../../src/core/database/boundConnection.ts";
import type { DatabaseConnection } from "../../src/db/connection";
import type { CacheLike } from "../../src/types/services";

type TransactionCapableConnection = CoreDatabaseConnection & {
  begin<TValue>(
    callback: (transaction: CoreDatabaseConnection) => Promise<TValue>,
  ): Promise<TValue>;
};

function bindFakeTransactionConnection(): void {
  const transactionConnection: CoreDatabaseConnection = {
    async unsafe() {
      return [];
    },
  };

  bindDatabaseConnection({
    async unsafe() {
      return [];
    },
    async begin(callback) {
      return await callback(transactionConnection);
    },
  } as TransactionCapableConnection);
}

function resetFakeTransactionConnection(): void {
  resetBoundDatabaseConnection();
}

const defaultTestTenant = {
  id: 1,
  slug: "acme",
  plan: "free" as const,
  region: "eu" as const,
};

type MockQuery = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

function readInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function createMockDatabaseConnection(
  query: MockQuery,
  overrides: Partial<DatabaseConnection> = {},
): DatabaseConnection {
  const connection = Object.assign(query, {
    unsafe: async () => [] as unknown[],
    close: async () => undefined,
    begin: async <T>(callback: (transaction: DatabaseConnection) => Promise<T>) =>
      callback(connection),
    ...overrides,
  }) as DatabaseConnection;

  return connection;
}

async function restoreDefaultDatabaseConnection(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    return;
  }

  const { replaceDatabaseConnectionForTests } = await import("../../src/db/connection");
  await replaceDatabaseConnectionForTests(
    new SQL({
      url,
      max: readInteger("DB_POOL_MAX", 10),
      idleTimeout: readInteger("DB_POOL_IDLE_TIMEOUT", 30),
      maxLifetime: readInteger("DB_POOL_MAX_LIFETIME", 3600),
      connectionTimeout: readInteger("DB_CONNECTION_TIMEOUT", 10),
    }),
  );
}

function createMockCache(overrides: Partial<CacheLike> = {}): CacheLike {
  return {
    get: async () => undefined,
    remember: async (_key, callback) => callback(),
    forget: async () => true,
    flush: async () => undefined,
    tags: () => ({
      remember: async (_key, callback) => callback(),
      flush: async () => 0,
    }),
    getOrSet: async (_key, loader) => loader(),
    invalidate: async () => true,
    invalidateByPrefix: async () => 0,
    clear: async () => undefined,
    size: async () => 0,
    ...overrides,
  };
}

function createMockDependencies(
  container: AppDependencies["container"],
  cache: CacheLike = createMockCache(),
): AppDependencies {
  return { container, cache };
}

function mockFetch(implementation: (...args: never[]) => unknown): typeof fetch {
  return implementation as unknown as typeof fetch;
}

async function clearPendingAuditLogs(): Promise<void> {
  const { runWithMigrationBypass } = await import("../../src/core/tenant/databaseTenantContext");
  const db = (await import("../../src/db/connection")).default;

  await runWithMigrationBypass(async () => {
    await db`UPDATE audit_log SET exported_at = NOW() WHERE exported_at IS NULL`;
  });
}

export {
  bindFakeTransactionConnection,
  clearPendingAuditLogs,
  createMockCache,
  createMockDatabaseConnection,
  createMockDependencies,
  defaultTestTenant,
  mockFetch,
  resetFakeTransactionConnection,
  restoreDefaultDatabaseConnection,
};
