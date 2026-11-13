import { afterEach } from "bun:test";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpPersistenceOptions } from "@getstrata/bootstrap/persistenceContracts";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import {
  passwordConfirmCookieName,
  passwordConfirmTtlSeconds,
} from "@getstrata/core/auth/passwordConfirmCookie";
import type { Application } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { CORE_HTTP_CLEANUP_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { requireConfiguredSecret } from "@getstrata/core/runtime/appKeyPrefix";
import { createApplication } from "@getstrata/core/runtime/application";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { HTTP_PERSISTENCE_OPTIONS } from "../../src/bootstrap/httpPersistence";
import type { DatabaseConnection } from "../../src/db/connection/createConnection";
import type { CacheLike } from "../../src/types/services";

const defaultTestTenant = {
  id: 1,
  slug: "acme",
  plan: "free" as const,
  region: "eu" as const,
};

type MockQuery = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

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

const dependencyOwners: Array<{
  application?: Application;
  start?: Promise<void>;
  cleanups: Array<() => void | Promise<void>>;
}> = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const owner of dependencyOwners.splice(0).reverse()) {
    for (const cleanup of owner.cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    await owner.start?.catch(() => {});
    try {
      await owner.application?.stop();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Test dependency cleanup failed.");
});

/** Each test fixture owns a real lazy application; it never supplies ambient ORM authority. */
function createMockDependencies(
  container: AppDependencies["container"],
  cache: CacheLike = createMockCache(),
  storage: StorageManager = new StorageManager(
    createStorageDriver({ driver: "local", rootDirectory: "storage" }),
  ),
  explicitInvoke?: PersistenceInvocation,
  http?: HttpPersistenceOptions,
): AppDependencies {
  const owner: {
    application?: Application;
    start?: Promise<void>;
    cleanups: Array<() => void | Promise<void>>;
  } = { cleanups: [] };
  dependencyOwners.push(owner);
  if (!container.has(CORE_HTTP_CLEANUP_TOKEN))
    container.set(CORE_HTTP_CLEANUP_TOKEN, (cleanup) => {
      owner.cleanups.push(cleanup);
    });
  const invoke: PersistenceInvocation =
    explicitInvoke ??
    (async (envelope, work) => {
      if (!owner.application) {
        owner.application = createApplication({
          providers: [],
          services: createDatabaseBindings({
            default: "main",
            connections: { main: { driver: "sqlite", filename: ":memory:" } },
          }),
        });
        const application = owner.application;
        owner.start = application.start();
      }
      await owner.start;
      return createPersistenceInvocation(owner.application, "main")(envelope, work);
    });
  if (!container.has(HTTP_PERSISTENCE_OPTIONS)) {
    const anonymous = new AuthManager(
      new GuestGuard({
        production: false,
        allowDevHeaders: false,
        abilities: { admin: [], member: [] },
      }),
    );
    const environment = Object.freeze({ ...process.env });
    const secret = (keys: readonly string[], fallback: string) =>
      keys.some((key) => environment[key]?.trim()) || !isProductionEnv(environment)
        ? requireConfiguredSecret([...keys], fallback, environment)
        : undefined;
    const signatureSecret = secret(
      ["SIGNED_URL_SECRET", "SESSION_SECRET", "OAUTH_STATE_SECRET"],
      "signed-url-secret",
    );
    const passwordSecret = secret(["SESSION_SECRET", "OAUTH_STATE_SECRET"], "session-secret");
    const options: HttpPersistenceOptions = http ?? {
      ...(signatureSecret ? { signatureSecret } : {}),
      ...(passwordSecret
        ? {
            passwordConfirmation: Object.freeze({
              secret: passwordSecret,
              cookieName: passwordConfirmCookieName(environment),
              ttlSeconds: passwordConfirmTtlSeconds(environment),
            }),
          }
        : {}),
      tenancy: "none",
      production: false,
      allowTenantDevHeaders: false,
      metadata: () => ({
        authenticate: async (request) => {
          const manager = container.has(CORE_AUTH_TOKEN)
            ? container.resolve(CORE_AUTH_TOKEN)
            : anonymous;
          return manager.authenticate(request);
        },
        memberships: async () => [],
        userTenantId: async () => defaultTestTenant.id,
        tenant: async (id) => (id === defaultTestTenant.id ? defaultTestTenant : null),
      }),
    };
    container.set(HTTP_PERSISTENCE_OPTIONS, Object.freeze(options));
  }
  return { container, cache, storage, invoke };
}

function mockFetch(implementation: (...args: never[]) => unknown): typeof fetch {
  return implementation as unknown as typeof fetch;
}

export {
  createMockCache,
  createMockDatabaseConnection,
  createMockDependencies,
  defaultTestTenant,
  mockFetch,
};
