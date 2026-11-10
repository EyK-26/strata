import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkApplicationBoundary,
  checkApplicationBoundaryFiles,
} from "../../scripts/check-application-boundary";

const contract = `
export interface Application { readonly id: string; start(): Promise<void>; }
export type Definition = { readonly name?: string };
`;
const runtime = `
import type { Application } from "../contracts/application";
export function createApplication(): Application {
  const signal = new AbortController().signal;
  const id = crypto.randomUUID();
  const task = Promise.resolve(signal.aborted);
  const timeout = setTimeout(async () => {}, 0);
  clearTimeout(timeout);
  return { id, async start() { await task; } };
}
`;

function inspect(nextRuntime: string, nextContract = contract) {
  return checkApplicationBoundary({ runtime: nextRuntime, contract: nextContract });
}

describe("M1 application owner boundary", () => {
  test("accepts the type contract and local lifecycle primitives", async () => {
    expect(await inspect(runtime)).toEqual([]);
    expect(await inspect('export type * from "../contracts/application";')).toEqual([]);

    expect(
      await inspect('import type * as ApplicationTypes from "../contracts/application";'),
    ).toEqual([]);
  });

  test.each([
    'import { type Application } from "../contracts/application.ts";',
    'import { setActiveApplicationContext } from "./applicationRegistry";',
    'import type { AppContext } from "../contracts/di";',
    'import type { Connection } from "@getstrata/core/database/connection";',
    'import "../contracts/application";',
    'import { Application } from "../contracts/application";',
    'import type { Application } from "../contracts/application" with { type: "json" };',
    'import type { Helper } from "./application/helper";',
    'const loader = import("./applicationRegistry");',
    'const path = "./applicationRegistry"; const loader = import(path);',
    'type Owner = import("./applicationRegistry").Owner;',
    'import oldOwner = require("./applicationRegistry");',
  ])("rejects unsupported dependency syntax: %s", async (source) => {
    expect((await inspect(source)).some((issue) => issue.rule === "dependency")).toBe(true);
  });

  test.each([
    'const load = require; load("./applicationRegistry");',
    'require("bun").serve({});',
    "const { serve } = Bun; serve({});",
    'Bun["serve"]({});',
    "const env = process.env;",
    "const { process: env } = globalThis;",
    'const transport = globalThis["Bun"];',
    "const globals = self;",
    "const globals = global;",
    'const response = fetch("https://example.test");',
    'new Worker("worker.ts");',
    'new WebSocket("wss://example.test");',
    'eval("Bun.serve({})");',
    'const evaluate = Function; evaluate("return globalThis")();',
    "const transport = { Bun };",
    "const transport = { [Bun]: true };",
    "const { value = process } = options;",
    "const value = condition ? process : fallback;",
    "interface ReservedNames { fetch(): void; }",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture must contain source interpolation.
    "const template = `${Bun.serve({})}`;",
    "const \\u0042un = transport;",
  ])("rejects ambient owner/resource access: %s", async (source) => {
    expect((await inspect(source)).some((issue) => issue.rule === "ambient-capability")).toBe(true);
  });

  test("checks executable property values while allowing inert labels, comments and strings", async () => {
    expect(
      await inspect(`
      // Bun.serve and require("old-owner") in comments are inert.
      const text = 'globalThis.process';
      const metadata = { Bun: text, process: text, fetch: text };
      const copy = metadata.Bun;
      interface Labels { Bun: string; execute(): void; }
    `),
    ).toEqual([]);
    expect((await inspect("const metadata = { process: Bun.serve };")).length).toBeGreaterThan(0);
  });

  test.each([
    "export const defaultTimeout = 30000;",
    "const identity = crypto.randomUUID(); export type Identity = typeof identity;",
    "export enum State { Constructed }",
    "export class Application {}",
    "export function createApplication() {}",
    "declare const owner: unknown;",
    "declare namespace Runtime { const value: unknown; }",
    'import type { Provider } from "./di";',
    "export { Application };",
    'export type { Owner } from "../runtime/applicationRegistry";',
  ])("rejects contract value/dependency declarations: %s", async (source) => {
    expect((await inspect(runtime, source)).some((issue) => issue.rule === "contract-value")).toBe(
      true,
    );
  });

  test("permits local type exports and rejects ambient dependencies inside type expressions", async () => {
    expect(await inspect(runtime, "interface App {} export type { App };")).toEqual([]);
    expect(
      await (await inspect(runtime, "export type Transport = typeof Bun.serve;")).some(
        (issue) => issue.rule === "ambient-capability",
      ),
    ).toBe(true);
  });

  test("fails closed on parse errors with source locations", async () => {
    const issues = await inspect("export function broken( {");
    expect(issues.some((issue) => issue.rule === "syntax")).toBe(true);
    expect(issues.every((issue) => issue.line > 0 && issue.column > 0)).toBe(true);
  });

  test("requires both migrated files instead of skipping a missing owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "strata-boundary-"));
    try {
      await expect(checkApplicationBoundaryFiles(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function inspectModule(file: string, source: string) {
  return checkApplicationBoundary({ runtime, contract, modules: { [file]: source } });
}

describe("M3b1 explicit SQL compiler boundary", () => {
  test("permits explicit compiler inputs and rejects ambient dialect and connection dependencies", () => {
    const query = "src/core/database/query.ts";
    const relations = "src/core/database/relationQueries.ts";
    expect(inspectModule(query, 'import type { SqlDialect } from "./sqlDialects.ts";')).toEqual([]);
    expect(inspectModule(relations, 'import { buildSelectQuery } from "./query.ts";')).toEqual([]);
    for (const file of [query, relations]) {
      for (const source of [
        'import { currentSqlDialect } from "@getstrata/core/database/dialect";',
        'import type { Connection } from "./connection.ts";',
        'import { getDatabaseDriver } from "../schema/driver.ts";',
        'import { getDefaultConnection } from "./defaultConnection.ts";',
        'import { resolveApplicationDependencies } from "../runtime/applicationRegistry.ts";',
      ]) {
        expect(inspectModule(file, source).some((issue) => issue.rule === "dependency")).toBe(true);
      }
      expect(
        inspectModule(file, "const dialect = process.env.DB_CONNECTION;").some(
          (issue) => issue.rule === "ambient-capability",
        ),
      ).toBe(true);
    }
  });
});

describe("M2.3 cache and operation boundaries", () => {
  test.each([
    ["src/core/runtime/application.ts", 'import { AsyncLocalStorage } from "node:async_hooks";'],
    [
      "src/core/runtime/serviceGraph.ts",
      'import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";',
    ],
    [
      "src/bootstrap/providers/cache.ts",
      'import { resourceService, service } from "@getstrata/core/contracts/services"; import { CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";',
    ],
  ])("accepts the explicit ownership edge in %s", (file, source) => {
    expect(inspectModule(file, source)).toEqual([]);
  });

  test.each([
    ["src/core/runtime/executionTasks.ts", 'import { AsyncLocalStorage } from "node:async_hooks";'],
    ["src/core/runtime/application.ts", 'import { env } from "node:process";'],
    [
      "src/core/runtime/application.ts",
      'import { CORE_EXECUTION_OPERATIONS_TOKEN } from "../contracts/executionOperations";',
    ],
    ["src/bootstrap/providers/cache.ts", 'import { legacyCacheProvider } from "../legacyCache";'],
    [
      "src/bootstrap/cachedJson.ts",
      'import { resolveApplicationCache } from "./applicationRegistry";',
    ],
    [
      "src/core/cache/repository.ts",
      'import { createAsyncContextStore } from "../runtime/asyncContextStore";',
    ],
  ])("rejects a second owner or legacy lookup in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "dependency")).toBe(true);
  });

  test.each([
    ["src/bootstrap/providers/cache.ts", "const namespace = process.env.APP_KEY_PREFIX;"],
    ["src/core/http/conditionalResponse.ts", 'import { isEtagEnabled } from "./etag";'],
    ["src/core/contracts/executionOperations.ts", 'const token = Symbol.for("operations");'],
  ])("rejects mutable ambient policy in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "ambient-capability")).toBe(
      true,
    );
  });
});

describe("M2.1 neutral value graph", () => {
  test("view token artifact imports only its canonical factory and erased renderer type", () => {
    const file = "src/core/view/tokens.ts";
    expect(
      inspectModule(
        file,
        'import { createServiceToken } from "@getstrata/core/contracts/token"; import type { ViewRenderer } from "./viewRenderer"; export const CORE_VIEW_RENDERER_TOKEN = createServiceToken<ViewRenderer>("core.viewRenderer");',
      ),
    ).toEqual([]);
    expect(
      inspectModule(
        file,
        'import { createServiceToken } from "../contracts/token"; export const token = createServiceToken("view");',
      ).some((issue) => issue.rule === "dependency"),
    ).toBe(true);
    expect(
      inspectModule(
        file,
        'import { ViewRenderer } from "./viewRenderer"; export const renderer = ViewRenderer;',
      ).some((issue) => issue.rule === "dependency"),
    ).toBe(true);
  });

  test.each([
    [
      "src/core/contracts/token.ts",
      'export const createServiceToken = () => Object.freeze({ key: Symbol("token") });',
    ],
    [
      "src/core/contracts/services.ts",
      'import { assertServiceToken } from "@getstrata/core/contracts/token"; export const service = assertServiceToken;',
    ],
    [
      "src/core/contracts/container.ts",
      'import { serviceTokenKey } from "@getstrata/core/contracts/token"; export const key = serviceTokenKey;',
    ],
    [
      "src/core/cache/tokens.ts",
      'import type { CacheLike } from "../../types/services"; import { createServiceToken } from "@getstrata/core/contracts/token"; export const CORE_CACHE_TOKEN = createServiceToken<CacheLike>("core.cache");',
    ],
    [
      "src/core/config/configSnapshot.ts",
      'import type { ApplicationConfigValue } from "../contracts/application"; export const copy = (value: ApplicationConfigValue) => value;',
    ],
    [
      "src/core/config/applicationConfig.ts",
      'import { copy } from "./configSnapshot"; import { validateEnv } from "@getstrata/core/config/envSchema"; export const parse = (input: Record<string,string>) => copy(validateEnv({}, input));',
    ],
    [
      "src/core/runtime/serviceGraph.ts",
      'import { serviceTokenKey } from "@getstrata/core/contracts/token"; export const validate = serviceTokenKey;',
    ],
    [
      "src/core/runtime/resourceJournal.ts",
      'import type { ResourceSpec } from "../contracts/application"; export type Spec = ResourceSpec<unknown>;',
    ],
    [
      "src/core/contracts/serviceTokens.ts",
      'export { CORE_CACHE_TOKEN } from "@getstrata/core/cache/tokens";',
    ],
  ])("accepts explicit neutral edges in %s", (file, source) => {
    expect(inspectModule(file, source)).toEqual([]);
  });

  test("accepts application composition and erases application contract type dependencies", () => {
    expect(
      checkApplicationBoundary({
        runtime:
          'import { ServiceContainer } from "@getstrata/core/contracts/container"; import { validate } from "./serviceGraph"; import { copy } from "../config/configSnapshot"; export { service } from "@getstrata/core/contracts/services";',
        contract:
          'import type { ServiceToken } from "./token"; import type { ServiceDeclaration } from "./services"; export type Definitions = ServiceDeclaration[];',
      }),
    ).toEqual([]);
  });

  test.each([
    [
      "src/core/runtime/serviceGraph.ts",
      'import { resolveApplicationCache } from "./applicationRegistry";',
    ],
    ["src/core/runtime/serviceGraph.ts", 'import type { Request } from "../http/route";'],
    [
      "src/core/runtime/resourceJournal.ts",
      'import { ServiceContainer } from "@getstrata/core/contracts/container";',
    ],
    [
      "src/core/runtime/application.ts",
      'import { parseApplicationConfig } from "../config/applicationConfig";',
    ],
    ["src/core/runtime/application.ts", 'import { validateEnv } from "../config/envSchema";'],
    ["src/core/contracts/container.ts", 'import { createServiceToken } from "./token";'],
    ["src/core/cache/tokens.ts", 'import { createServiceToken } from "../contracts/token";'],
    [
      "src/core/contracts/token.ts",
      'import { ServiceContainer } from "@getstrata/core/contracts/container";',
    ],
    ["src/core/contracts/services.ts", 'import type { AuthManager } from "../auth/guard";'],
    ["src/core/config/configSnapshot.ts", 'import { validateEnv } from "./envSchema";'],
    ["src/core/runtime/unapprovedHelper.ts", "export const helper = 1;"],
    ["src/core/contracts/token.ts", 'const token = import("./container");'],
    ["src/core/contracts/services.ts", 'export type { AppContext } from "./di";'],
  ])("rejects unapproved or noncanonical edges in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "dependency")).toBe(true);
  });

  test.each([
    ["src/core/contracts/token.ts", 'const key = Symbol.for("application.tokens");'],
    ["src/core/config/applicationConfig.ts", "const input = process.env;"],
    ["src/core/runtime/serviceGraph.ts", "resolveApplicationCache();"],
    ["src/core/runtime/resourceJournal.ts", "const input = process.env;"],
    ["src/core/config/configSnapshot.ts", "const input = globalThis.config;"],
  ])("rejects ambient ownership in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "ambient-capability")).toBe(
      true,
    );
  });
});

describe("M2.2b execution context boundary", () => {
  test.each([
    [
      "src/core/contracts/executionContext.ts",
      'import { createServiceToken } from "@getstrata/core/contracts/token"; import type { ExecutionContext } from "./application"; export const CORE_EXECUTION_CONTEXT_TOKEN = createServiceToken<ExecutionContext>("core.executionContext");',
    ],
    [
      "src/core/runtime/executionContext.ts",
      'import { copyApplicationConfig } from "../config/configSnapshot"; import type { ExecutionEnvelope } from "../contracts/application"; export const normalize = (envelope: ExecutionEnvelope) => copyApplicationConfig(envelope.metadata);',
    ],
    [
      "src/core/runtime/application.ts",
      'import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext"; import { normalizeExecutionEnvelope } from "./executionContext"; export { CORE_EXECUTION_CONTEXT_TOKEN };',
    ],
    [
      "src/core/runtime/serviceGraph.ts",
      'import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext"; export const token = CORE_EXECUTION_CONTEXT_TOKEN;',
    ],
  ])("accepts explicit execution context edge in %s", (file, source) => {
    expect(inspectModule(file, source)).toEqual([]);
  });

  test.each([
    [
      "src/core/contracts/executionContext.ts",
      'import { createServiceToken } from "./token"; export const token = createServiceToken("context");',
    ],
    [
      "src/core/contracts/executionContext.ts",
      'import { createApplication } from "../runtime/application";',
    ],
    ["src/core/contracts/executionContext.ts", 'import { ExecutionContext } from "./application";'],
    [
      "src/core/runtime/executionContext.ts",
      'import { ServiceContainer } from "@getstrata/core/contracts/container";',
    ],
    [
      "src/core/runtime/executionContext.ts",
      'import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";',
    ],
    ["src/core/runtime/executionContext.ts", 'import type { Request } from "../http/route";'],
    [
      "src/core/runtime/application.ts",
      'import { CORE_EXECUTION_CONTEXT_TOKEN } from "../contracts/executionContext";',
    ],
    [
      "src/core/runtime/serviceGraph.ts",
      'import { CORE_EXECUTION_CONTEXT_TOKEN } from "../contracts/executionContext";',
    ],
  ])("rejects broadened or relative canonical execution edge in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "dependency")).toBe(true);
  });

  test.each([
    ["src/core/contracts/executionContext.ts", 'const token = Symbol.for("execution.context");'],
    ["src/core/runtime/executionContext.ts", "const context = process.env;"],
    ["src/core/runtime/executionContext.ts", "const value = resolveApplicationConfig();"],
  ])("rejects ambient execution ownership in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "ambient-capability")).toBe(
      true,
    );
  });
});

describe("M2.2c joined task boundary", () => {
  test.each([
    [
      "src/core/runtime/application.ts",
      'import { runExecutionTasks } from "./executionTasks"; export const run = runExecutionTasks;',
    ],
    [
      "src/core/runtime/executionTasks.ts",
      'import type { CommandScope, ExecutionTaskOutcome } from "../contracts/application"; export type Task = (scope: CommandScope) => ExecutionTaskOutcome<unknown>;',
    ],
  ])("accepts explicit task coordinator edge in %s", (file, source) => {
    expect(inspectModule(file, source)).toEqual([]);
  });
  test.each([
    'import { ServiceContainer } from "@getstrata/core/contracts/container";',
    'import { ResourceJournal } from "./resourceJournal";',
    'import { createApplication } from "./application";',
    'import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";',
    'import type { Request } from "../http/route";',
    'import type { AppContext } from "../contracts/di";',
  ])("rejects task coordinator dependency %s", (source) => {
    expect(
      inspectModule("src/core/runtime/executionTasks.ts", source).some(
        (issue) => issue.rule === "dependency",
      ),
    ).toBe(true);
  });
  test.each([
    "const current = process.env;",
    "const tasks = globalThis.tasks;",
    'const key = Symbol.for("current.execution");',
  ])("rejects ambient task ownership %s", (source) => {
    expect(
      inspectModule("src/core/runtime/executionTasks.ts", source).some(
        (issue) => issue.rule === "ambient-capability",
      ),
    ).toBe(true);
  });
});

describe("M3a explicit persistence boundaries", () => {
  test("scans quoted native metric templates and checks nested interpolation expressions", () => {
    const file = "src/core/database/acquisitionMetrics.ts";
    expect(inspectModule(file, 'const text = `bucket{outcome="${outcome}"} ${value}`;')).toEqual(
      [],
    );
    expect(
      inspectModule(file, "const text = `outer ${`inner ${globalThis.secret}`} end`;").some(
        (issue) => issue.rule === "ambient-capability",
      ),
    ).toBe(true);
    expect(
      inspectModule(file, "const text = `outer ${({ name: process.env }).name} end`;").some(
        (issue) => issue.rule === "ambient-capability",
      ),
    ).toBe(true);
  });
  test("keeps acquisition metrics factory and native observation on one canonical weak-map identity", () => {
    expect(
      inspectModule(
        "src/core/database/rawPostgres.ts",
        'import { observeTransactionAcquisition } from "@getstrata/core/database/acquisitionMetrics";',
      ),
    ).toEqual([]);
    expect(
      inspectModule(
        "src/core/database/rawPostgres.ts",
        'import { observeTransactionAcquisition } from "./acquisitionMetrics";',
      ).some((issue) => issue.rule === "dependency"),
    ).toBe(true);
  });
  test.each([
    [
      "src/core/contracts/executionOwnership.ts",
      'import { createServiceToken } from "@getstrata/core/contracts/token"; import type { ResourceSpec } from "./application";',
    ],
    [
      "src/core/runtime/application.ts",
      'import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";',
    ],
    [
      "src/core/database/bindings.ts",
      'import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens"; import { createRawSqlitePool } from "./rawSqlite";',
    ],
    [
      "src/core/database/transactionSession.ts",
      'import { AsyncLocalStorage } from "node:async_hooks"; import type { OwnedExecution } from "../contracts/executionOwnership";',
    ],
    [
      "src/core/database/rawSqlite.ts",
      'import { Database } from "bun:sqlite"; import { resolve } from "node:path"; import { nativeTransaction } from "./nativeTransactions";',
    ],
    [
      "src/core/database/rawPostgres.ts",
      'import type { ReservedSQL } from "bun"; import { createNativePostgresPool } from "./postgresNative";',
    ],
    ["src/core/database/postgresNative.ts", 'import { SQL } from "bun";'],
    [
      "src/core/database/mysqlNative.ts",
      'import { missingOptionalPeer } from "../runtime/optionalPeer.ts"; async function load() { return import("mysql2/promise"); }',
    ],
    [
      "src/core/http/databaseError.ts",
      'import { PersistenceError } from "@getstrata/core/database/errors"; import { ConflictError } from "@getstrata/core/errors/http";',
    ],
  ])("accepts the exact persistence authority in %s", (file, source) => {
    expect(inspectModule(file, source)).toEqual([]);
  });

  test.each([
    ["src/core/database/errors.ts", 'import { ConflictError } from "@getstrata/core/errors/http";'],
    ["src/core/database/session.ts", 'import type { HttpError } from "../errors/http";'],
    [
      "src/core/database/transactionSession.ts",
      'import { mapDatabaseHttpError } from "../http/databaseError";',
    ],
    [
      "src/core/database/rawSqlite.ts",
      'import { getActiveDatabaseConnection } from "./connectionContext";',
    ],
    [
      "src/core/database/rawMysql.ts",
      'import { createAsyncContextStore } from "../runtime/asyncContextStore";',
    ],
    ["src/core/database/rawPostgres.ts", 'import { currentSqlDialect } from "./dialect";'],
    ["src/core/database/manager.ts", 'import { getDefaultConnection } from "./defaultConnection";'],
    [
      "src/core/database/sessionFactory.ts",
      'import { defaultConnection } from "./defaultConnection";',
    ],
    ["src/core/database/session.ts", 'import { AsyncLocalStorage } from "node:async_hooks";'],
    ["src/core/database/rawMysql.ts", 'import { AsyncLocalStorage } from "node:async_hooks";'],
    ["src/core/database/rawSqlite.ts", 'import { SQL } from "bun";'],
    ["src/core/database/rawMysql.ts", 'import { resolve } from "node:path";'],
    ["src/core/database/postgresNative.ts", 'import { Database } from "bun:sqlite";'],
    ["src/core/database/mysqlNative.ts", 'import mysql from "mysql2/promise";'],
    [
      "src/core/database/mysqlNative.ts",
      'const path = "mysql2/promise"; const load = import(path);',
    ],
    ["src/core/database/mysqlNative.ts", 'const load = import("mysql2");'],
    ["src/core/database/rawMysql.ts", 'const load = import("mysql2/promise");'],
    ["src/core/database/bindings.ts", 'import { DATABASE_SESSION_TOKEN } from "./tokens";'],
    ["src/core/http/databaseError.ts", 'import { PersistenceError } from "../database/errors";'],
    ["src/core/http/databaseError.ts", 'import { ConflictError } from "../errors/http";'],
    ["src/core/database/driverPorts.ts", 'export type { HttpError } from "../errors/http";'],
  ])(
    "rejects HTTP leakage, native broadening, legacy routing, or duplicate identity in %s",
    (file, source) => {
      expect(inspectModule(file, source).some((issue) => issue.rule === "dependency")).toBe(true);
    },
  );

  test.each([
    ["src/core/database/mysqlNative.ts", 'const load = require("mysql2/promise");'],
    ["src/core/database/bindings.ts", "const definition = process.env;"],
    ["src/core/database/manager.ts", "const pools = globalThis.pools;"],
    ["src/core/database/sessionFactory.ts", "const current = getActiveDatabaseConnection();"],
    ["src/core/database/transactionSession.ts", "const current = currentSqlDialect();"],
    ["src/core/database/rawMysql.ts", "const inherited = globalThis.connection;"],
    ["src/core/database/tokens.ts", 'const token = Symbol.for("database.session");'],
  ])("rejects root/session/native ambient ownership in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "ambient-capability")).toBe(
      true,
    );
  });
});
