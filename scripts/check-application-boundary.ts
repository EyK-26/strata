#!/usr/bin/env bun

/** Application ownership and its private journal stay independent of legacy adapters. */
import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { createScanner, SyntaxKind, tokenIsIdentifierOrKeyword } from "typescript/unstable/ast";

const RUNTIME_PATH = "src/core/runtime/application.ts";
const CONTRACT_PATH = "src/core/contracts/application.ts";
const PATH = (module: string) => posix.normalize(`src/core/${module}.ts`);
const neutralEdges: Readonly<
  Record<string, { values: readonly string[]; types: readonly string[] }>
> = {
  [RUNTIME_PATH]: {
    values: [
      "contracts/container",
      "contracts/services",
      "contracts/executionContext",
      "contracts/executionOperations",
      "contracts/executionOwnership",
      "runtime/serviceGraph",
      "runtime/resourceJournal",
      "runtime/executionContext",
      "runtime/executionTasks",
      "config/configSnapshot",
    ],
    types: ["contracts/application", "contracts/services", "contracts/token"],
  },
  [CONTRACT_PATH]: { values: [], types: ["contracts/token", "contracts/services"] },
  [PATH("runtime/resourceJournal")]: { values: [], types: ["contracts/application"] },
  [PATH("runtime/executionTasks")]: {
    values: [],
    types: [
      "contracts/application",
      "contracts/executionOperations",
      "contracts/executionOwnership",
    ],
  },
  [PATH("runtime/executionContext")]: {
    values: ["config/configSnapshot"],
    types: ["contracts/application"],
  },
  [PATH("contracts/executionContext")]: {
    values: ["contracts/token"],
    types: ["contracts/application"],
  },
  [PATH("contracts/executionOperations")]: { values: ["contracts/token"], types: [] },
  [PATH("contracts/executionOwnership")]: {
    values: ["contracts/token"],
    types: ["contracts/application", "contracts/services"],
  },
  [PATH("runtime/serviceGraph")]: {
    values: [
      "contracts/token",
      "contracts/services",
      "contracts/executionContext",
      "contracts/executionOperations",
      "contracts/executionOwnership",
    ],
    types: [
      "contracts/container",
      "contracts/services",
      "contracts/token",
      "contracts/application",
      "runtime/resourceJournal",
    ],
  },
  [PATH("contracts/token")]: { values: [], types: [] },
  [PATH("contracts/services")]: {
    values: ["contracts/token"],
    types: ["contracts/token", "contracts/application"],
  },
  [PATH("contracts/container")]: {
    values: ["contracts/token", "contracts/services"],
    types: ["contracts/token", "contracts/services"],
  },
  [PATH("view/tokens")]: {
    values: ["contracts/token"],
    types: ["view/viewRenderer", "view/etaViewEngine", "view/webErrorView"],
  },
  [PATH("cache/tokens")]: {
    values: ["contracts/token"],
    types: ["../types/services", "cache/repository"],
  },
  [PATH("cache/repository")]: {
    values: ["cache/taggedCache"],
    types: ["cache/store", "../types/services", "contracts/executionOperations"],
  },
  [PATH("cache/createCacheStore")]: {
    values: [
      "cache/redisCacheStore",
      "cache/simpleCache",
      "cache/simpleCacheStore",
      "config/configSnapshot",
    ],
    types: ["cache/store"],
  },
  [PATH("../bootstrap/providers/cache")]: {
    values: [
      "contracts/services",
      "contracts/executionOperations",
      "cache/tokens",
      "cache/createCacheStore",
      "cache/repository",
    ],
    types: ["runtime/application"],
  },
  [PATH("../bootstrap/cachedJson")]: {
    // Adapter assembly selects its captured response policy by a canonical token.
    values: ["http/conditionalResponse", "contracts/serviceTokens"],
    types: ["../bootstrap/contracts", "../types/services", "cache/tokens"],
  },
  [PATH("http/conditionalResponse")]: { values: ["http/etag"], types: [] },
  [PATH("config/configSnapshot")]: { values: [], types: ["contracts/application"] },
  [PATH("config/applicationConfig")]: {
    values: ["config/configSnapshot", "config/envSchema"],
    types: ["contracts/application", "config/envSchema"],
  },
  [PATH("database/bindings")]: {
    values: [
      "contracts/executionContext",
      "contracts/executionOperations",
      "contracts/executionOwnership",
      "contracts/services",
      "contracts/token",
      "config/configSnapshot",
      "database/errors",
      "database/manager",
      "database/ormInternal",
      "database/modelRegistry",
      "database/rawMysql",
      "database/rawPostgres",
      "database/rawSqlite",
      "database/sessionFactory",
      "database/tokens",
    ],
    types: ["contracts/application", "database/driverPorts"],
  },
  [PATH("database/manager")]: {
    values: ["database/errors"],
    types: ["database/driverPorts", "database/ormInternal"],
  },
  [PATH("database/sessionFactory")]: {
    values: ["database/errors", "database/transactionSession", "database/modelRegistry"],
    types: [
      "contracts/application",
      "contracts/executionOperations",
      "contracts/executionOwnership",
      "database/driverPorts",
      "database/manager",
      "database/session",
      "database/modelRegistry",
    ],
  },
  [PATH("database/session")]: {
    values: [],
    types: [
      "database/driverPorts",
      "database/sqlDialects",
      "database/transactionSession",
      "database/modelRegistry",
    ],
  },
  [PATH("database/transactionSession")]: {
    values: ["database/errors", "database/ormInternal"],
    types: [
      "contracts/application",
      "contracts/executionOperations",
      "contracts/executionOwnership",
      "database/driverPorts",
      "database/sqlDialects",
      "database/modelRegistry",
      "database/session",
    ],
  },
  [PATH("database/tokens")]: {
    values: ["contracts/token"],
    types: ["database/manager", "database/session"],
  },
  [PATH("database/errors")]: { values: [], types: [] },
  [PATH("database/sqlDialects")]: { values: [], types: [] },
  [PATH("database/query")]: {
    values: [],
    types: ["database/sqlDialects", "database/table", "database/types", "database/whereBuilder"],
  },
  [PATH("database/relationQueries")]: {
    values: ["database/query"],
    types: ["database/sqlDialects", "database/table", "database/types"],
  },
  [PATH("database/driverPorts")]: {
    values: [],
    types: [
      "contracts/application",
      "database/acquisitionMetrics",
      "database/sqlDialects",
      "database/definitions",
      "contracts/token",
    ],
  },
  [PATH("database/rawSqlite")]: {
    values: ["database/nativeTransactions", "database/sqlDialects"],
    types: ["contracts/application", "database/driverPorts"],
  },
  [PATH("database/rawMysql")]: {
    values: ["database/mysqlNative", "database/nativeTransactions", "database/sqlDialects"],
    types: ["contracts/application", "database/driverPorts"],
  },
  [PATH("database/rawPostgres")]: {
    values: [
      "database/acquisitionMetrics",
      "database/nativeTransactions",
      "database/postgresNative",
      "database/sqlDialects",
    ],
    types: ["contracts/application", "database/driverPorts"],
  },
  [PATH("database/nativeTransactions")]: { values: [], types: ["database/driverPorts"] },
  [PATH("database/mysqlNative")]: { values: ["runtime/optionalPeer"], types: [] },
  [PATH("database/postgresNative")]: { values: [], types: [] },
  [PATH("database/acquisitionMetrics")]: { values: [], types: [] },
  [PATH("runtime/optionalPeer")]: { values: [], types: [] },
  [PATH("http/databaseError")]: { values: ["database/errors", "errors/http"], types: [] },
  [PATH("auth/policy")]: { values: [], types: [] },
  [PATH("auth/authReader")]: {
    values: ["auth/authOutcome", "runtime/asyncContextStore", "auth/authContext"],
    types: [],
  },
  [PATH("auth/guard")]: {
    values: [
      "auth/authOutcome",
      "http/statelessAuth",
      "security/timingSafeCompare",
      "auth/accountState",
      "auth/authContext",
      "auth/basicAuthGuard",
      "auth/jwtGuard",
      "auth/requireAuthCapability",
    ],
    types: ["contracts/authUserDirectory"],
  },
  [PATH("contracts/authUserDirectory")]: { values: [], types: ["auth/authContext"] },
  [PATH("errors/http")]: {
    values: ["auth/authOutcome", "auth/policy", "database/errors"],
    types: [],
  },
  [PATH("auth/authOutcome")]: {
    values: ["contracts/authUserDirectory", "auth/accountState"],
    types: ["auth/authContext"],
  },

  // M3b2 immutable definitions and the single private ORM runtime closure.
  [PATH("database/definitions")]: {
    values: ["contracts/token"],
    types: [
      "contracts/application",
      "contracts/persistence",
      "contracts/services",
      "pagination/index",
      "database/baseRepository",
      "database/driverPorts",
      "database/model",
      "database/modelAttributes",
      "database/modelQuery",
      "database/relationQuery",
      "database/repositoryQuery",
      "database/session",
      "database/sqlDialects",
      "database/table",
      "database/transactionSession",
      "database/types",
    ],
  },
  [PATH("database/modelRegistry")]: {
    values: [
      "contracts/services",
      "contracts/token",
      "database/definitions",
      "database/ormInternal",
      "database/ormRuntime",
      "events/eventBusClass",
      "tenant/scopedDatabasePolicy",
    ],
    types: [
      "contracts/application",
      "contracts/executionOwnership",
      "database/driverPorts",
      "database/session",
      "database/transactionSession",
    ],
  },
  [PATH("contracts/persistence")]: {
    values: [],
    types: ["contracts/application", "database/session"],
  },
  [PATH("tenant/scopedDatabasePolicy")]: {
    values: ["database/ormInternal"],
    types: [
      "contracts/application",
      "contracts/executionOwnership",
      "contracts/persistence",
      "database/session",
    ],
  },
  [PATH("database/ormInternal")]: {
    values: ["contracts/token", "database/errors"],
    types: [
      "contracts/executionOwnership",
      "database/baseRepository",
      "database/definitions",
      "database/driverPorts",
      "database/model",
      "database/session",
      "database/transactionSession",
    ],
  },
  [PATH("database/ormRuntime")]: {
    values: ["database/baseRepository", "database/repositoryQuery", "database/model"],
    types: [],
  },
  [PATH("database/baseRepository")]: {
    values: [
      "database/errors",
      "database/ormInternal",
      "pagination/index",
      "database/keyset",
      "database/query",
      "database/queryPlanSnapshot",
      "database/relationQueries",
      "database/relationships",
      "database/repositoryQuery",
    ],
    types: [
      "database/definitions",
      "database/sqlDialects",
      "database/table",
      "database/types",
      "database/whereBuilder",
    ],
  },
  [PATH("database/model")]: {
    values: [
      "database/errors",
      "database/ormInternal",
      "database/baseRepository",
      "database/inflection",
      "database/modelAttributes",
      "database/modelQuery",
      "database/query",
      "database/queryPlanSnapshot",
      "database/relationQuery",
      "database/relationships",
      "database/definitions",
    ],
    types: ["pagination/index", "database/repositoryQuery", "database/types"],
  },
  [PATH("auth/password")]: { values: [], types: [] },
  [PATH("database/modelAttributes")]: { values: ["auth/password"], types: [] },
  [PATH("database/modelQuery")]: {
    values: [
      "database/errors",
      "database/ormInternal",
      "database/model",
      "database/modelAttributes",
      "database/queryPlanSnapshot",
      "database/repositoryQuery",
    ],
    types: [
      "pagination/index",
      "database/baseRepository",
      "database/relationQuery",
      "database/relationships",
      "database/types",
      "database/whereBuilder",
    ],
  },
  [PATH("database/relationQuery")]: {
    values: [
      "database/ormInternal",
      "database/baseRepository",
      "database/model",
      "database/pluck",
      "database/query",
      "database/queryPlanSnapshot",
    ],
    types: [
      "database/relationships",
      "database/repositoryQuery",
      "database/sqlDialects",
      "database/types",
    ],
  },
  [PATH("database/repositoryQuery")]: {
    values: [
      "database/ormInternal",
      "database/baseRepository",
      "database/pluck",
      "database/query",
      "database/queryPlanSnapshot",
      "database/relationships",
      "database/whereBuilder",
    ],
    types: ["database/definitions", "pagination/index", "database/types"],
  },
  [PATH("database/queryPlanSnapshot")]: { values: ["database/definitions"], types: [] },
  [PATH("database/relationships")]: { values: [], types: [] },
  [PATH("database/keyset")]: {
    values: [],
    types: [
      "pagination/index",
      "database/sqlDialects",
      "database/table",
      "database/types",
      "database/whereBuilder",
    ],
  },
  [PATH("database/inflection")]: { values: [], types: [] },
  [PATH("database/table")]: { values: [], types: ["database/types"] },
  [PATH("database/types")]: { values: [], types: ["database/whereBuilder"] },
  [PATH("database/whereBuilder")]: { values: [], types: ["database/types"] },
  [PATH("database/pluck")]: { values: [], types: ["database/types"] },
  [PATH("pagination/index")]: { values: [], types: [] },
  [PATH("events/eventBusClass")]: { values: [], types: [] },
  // Typed adapter tokens retain enumerated type edges, never runtime ownership.
  [PATH("contracts/serviceTokens")]: {
    values: ["contracts/token", "cache/tokens"],
    types: [
      "auth/abilityChecker",
      "auth/authReader",
      "auth/policy",
      "events/eventBusClass",
      "mail/mailer",
      "storage/storage",
      "tracing/otel",
      "queue/index",
      "queue/queueServices",
      "http/throttleMiddleware",
      "tenant/tenantMiddleware",
      "contracts/authUserDirectory",
      "contracts/container",
    ],
  },
};
const canonicalValues = new Set(
  [
    "auth/authOutcome",
    "auth/policy",
    "contracts/authUserDirectory",
    "database/definitions",
    "contracts/token",
    "contracts/container",
    "contracts/services",
    "contracts/executionContext",
    "contracts/executionOperations",
    "contracts/executionOwnership",
    "database/tokens",
    "database/errors",
    "database/acquisitionMetrics",
    "errors/http",
    "contracts/serviceTokens",
    "cache/tokens",
    "config/applicationConfig",
    "view/tokens",
  ].map(PATH),
);
const AMBIENT_CAPABILITIES = new Set([
  "process",
  "globalThis",
  "global",
  "Bun",
  "Deno",
  "fetch",
  "Worker",
  "SharedWorker",
  "WebSocket",
  "WebSocketStream",
  "XMLHttpRequest",
  "EventSource",
  "BroadcastChannel",
  "MessageChannel",
  "navigator",
  "window",
  "document",
  "self",
  "require",
  "module",
  "exports",
  "eval",
  "Function",
  "resolveApplicationAuth",
  "resolveApplicationCache",
  "resolveApplicationConfig",
  "resolveApplicationDependencies",
  "resolveApplicationEventBus",
  "resolveApplicationPolicyGate",
  "resolveApplicationQueue",
  "setActiveApplicationContext",
  "registerDefaultDatabasePool",
  "getDefaultDatabasePool",
  "getDefaultDatabaseQuery",
  "getActiveDatabaseConnection",
  "getDatabaseConnection",
  "setDatabaseConnection",
  "currentSqlDialect",
  "overrideSqlDialect",
  "withConnection",
  "isEtagEnabled",
  "namespacedRedisKey",
]);

interface BoundaryDiagnostic {
  file: string;
  line: number;
  column: number;
  rule: "syntax" | "dependency" | "contract-value" | "ambient-capability";
  message: string;
}
interface ApplicationBoundarySources {
  runtime: string;
  contract: string;
  modules?: Readonly<Record<string, string>>;
}
interface Token {
  kind: SyntaxKind;
  text: string;
  value: string;
  start: number;
}

function tokensOf(source: string): Token[] {
  const scanner = createScanner(true, undefined, source);
  const tokens: Token[] = [];
  const templates: number[] = [];
  let previousEnd = -1;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    const top = templates.length - 1;
    if (kind === SyntaxKind.CloseBraceToken && top >= 0) {
      if (templates[top] === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templates.pop();
      } else templates[top] = (templates[top] ?? 0) - 1;
    } else if (kind === SyntaxKind.OpenBraceToken && top >= 0) {
      templates[top] = (templates[top] ?? 0) + 1;
    }
    if (kind === SyntaxKind.TemplateHead) templates.push(0);
    const end = scanner.getTokenEnd();
    if (end <= previousEnd) throw new Error("Boundary scanner did not advance.");
    previousEnd = end;
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
      start: scanner.getTokenStart(),
    });
  }
  return tokens;
}

interface DependencyEdge {
  path: string;
  typeOnly: boolean;
}
function dependencyEdge(tokens: Token[], index: number): DependencyEdge | undefined {
  const typeOnly = tokens[index + 1]?.text === "type";
  let cursor = index + (typeOnly ? 2 : 1);
  const clause: Token[] = [];
  while (cursor < tokens.length && tokens[cursor]?.text !== "from") {
    const token = tokens[cursor];
    if (
      !token ||
      !(tokenIsIdentifierOrKeyword(token.kind) || ["{", "}", ",", "*"].includes(token.text))
    )
      return undefined;
    clause.push(token);
    cursor++;
  }
  const specifier = tokens[cursor + 1];
  if (
    !clause.length ||
    specifier?.kind !== SyntaxKind.StringLiteral ||
    ["with", "assert"].includes(tokens[cursor + 2]?.text ?? "")
  )
    return undefined;
  return { path: specifier.value, typeOnly };
}
const privateAliases: Readonly<Record<string, string>> = {
  "#strata-orm-internal": PATH("database/ormInternal"),
  "#strata-orm-runtime": PATH("database/ormRuntime"),
};
function resolveEdge(file: string, edge: string): string | undefined {
  if (Object.hasOwn(privateAliases, edge)) return privateAliases[edge];
  if (edge.startsWith("@getstrata/core/"))
    return PATH(edge.slice("@getstrata/core/".length).replace(/\.ts$/, ""));
  if (edge.startsWith(".")) {
    const path = posix.normalize(posix.join(posix.dirname(file), edge));
    return path.endsWith(".ts") ? path : `${path}.ts`;
  }
  return undefined;
}
function allows(file: string, edge: DependencyEdge): boolean {
  // Existing execution owners propagate context; the private ORM lineage is rejection-only.
  if (
    [RUNTIME_PATH, PATH("database/transactionSession"), PATH("database/ormInternal")].includes(
      file,
    ) &&
    edge.path === "node:async_hooks"
  )
    return true;
  const nativeEdges: Readonly<Record<string, readonly string[]>> = {
    [PATH("database/rawSqlite")]: ["bun:sqlite", "node:path"],
    [PATH("database/postgresNative")]: ["bun"],
    [PATH("database/rawPostgres")]: edge.typeOnly ? ["bun"] : [],
  };
  if (nativeEdges[file]?.includes(edge.path)) return true;
  if (
    [
      PATH("database/modelRegistry"),
      PATH("database/model"),
      PATH("database/modelAttributes"),
    ].includes(file) &&
    edge.path === "node:util"
  )
    return true;
  const rules = neutralEdges[file];
  const target = resolveEdge(file, edge.path);
  if (!rules || !target) return false;
  const allowed = edge.typeOnly ? [...rules.types, ...rules.values] : rules.values;
  if (!allowed.map(PATH).includes(target)) return false;
  if (
    !edge.typeOnly &&
    Object.values(privateAliases).includes(target) &&
    !Object.hasOwn(privateAliases, edge.path)
  )
    return false;
  // Pure public identity artifacts must stay external even when the owner is bundled.
  return edge.typeOnly || !canonicalValues.has(target) || edge.path.startsWith("@getstrata/core/");
}

function checkApplicationBoundary(sources: ApplicationBoundarySources): BoundaryDiagnostic[] {
  const diagnostics: BoundaryDiagnostic[] = [];
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
  for (const [file, source] of [
    [RUNTIME_PATH, sources.runtime],
    [CONTRACT_PATH, sources.contract],
    ...Object.entries(sources.modules ?? {}),
  ] as const) {
    const report = (start: number, rule: BoundaryDiagnostic["rule"], message: string): void => {
      const prefix = source.slice(0, start).split("\n");
      diagnostics.push({
        file,
        line: prefix.length,
        column: (prefix.at(-1)?.length ?? 0) + 1,
        rule,
        message,
      });
    };
    let executableImports: readonly { path: string; kind: string }[] = [];
    try {
      const emitted = transpiler.transformSync(source);
      executableImports = transpiler.scan(source).imports;
      // Bun validates syntax and scans executable imports, including require and dynamic import.
      for (const edge of executableImports) {
        if (
          !(
            (edge.kind === "import-statement" &&
              allows(file, { path: edge.path, typeOnly: false })) ||
            (file === PATH("database/mysqlNative") &&
              edge.kind === "dynamic-import" &&
              edge.path === "mysql2/promise")
          )
        ) {
          report(
            0,
            "dependency",
            `Executable dependency '${edge.path}' (${edge.kind}) is outside the neutral module graph.`,
          );
        }
      }
      if (file === CONTRACT_PATH && emitted.trim()) {
        report(
          0,
          "contract-value",
          "Application contracts must erase completely; executable code is forbidden.",
        );
      }
    } catch (error) {
      report(0, "syntax", `Cannot parse application source: ${String(error)}`);
      continue;
    }
    if (!neutralEdges[file]) {
      report(0, "dependency", "No neutral boundary rule exists for this module.");
      continue;
    }
    let tokens: Token[];
    try {
      tokens = tokensOf(source);
    } catch (error) {
      report(0, "syntax", `Cannot scan application source: ${String(error)}`);
      continue;
    }
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (!token) continue;
      const previous = tokens[index - 1]?.text;
      const next = tokens[index + 1]?.text;
      const propertyAccess = previous === "." || previous === "?.";
      if (token.text === "import" && !propertyAccess) {
        const edge = dependencyEdge(tokens, index);
        // The optional native peer loader has exactly one literal dynamic-import authority.
        const mysqlPeer =
          file === PATH("database/mysqlNative") &&
          next === "(" &&
          tokens[index + 2]?.kind === SyntaxKind.StringLiteral &&
          tokens[index + 2]?.value === "mysql2/promise" &&
          tokens[index + 3]?.text === ")";
        const erasedTypeImport =
          next === "(" &&
          tokens[index + 2]?.kind === SyntaxKind.StringLiteral &&
          tokens[index + 3]?.text === ")" &&
          allows(file, { path: tokens[index + 2]!.value, typeOnly: true }) &&
          !executableImports.some(
            (item) => item.path === tokens[index + 2]?.value && item.kind === "dynamic-import",
          );
        if (!mysqlPeer && !erasedTypeImport && (!edge || !allows(file, edge))) {
          report(
            token.start,
            file === CONTRACT_PATH ? "contract-value" : "dependency",
            "Import is outside this module's explicit neutral dependency edges.",
          );
        }
      }
      if (token.text === "export" && !propertyAccess) {
        // A dependency reexport has 'from' before the next declaration/semicolon.
        let cursor = index + (next === "type" ? 2 : 1);
        if (["*", "{"].includes(tokens[cursor]?.text ?? "")) {
          while (
            cursor < tokens.length &&
            ![";", "from", "export"].includes(tokens[cursor]?.text ?? "")
          )
            cursor++;
          if (
            tokens[cursor]?.text === "from" &&
            !allows(file, dependencyEdge(tokens, index) ?? { path: "", typeOnly: false })
          ) {
            report(
              token.start,
              file === CONTRACT_PATH ? "contract-value" : "dependency",
              "Only erased contract type reexports are allowed.",
            );
          }
        }
      }
      if (token.text === "Symbol" && next === "." && tokens[index + 2]?.text === "for") {
        report(
          token.start,
          "ambient-capability",
          "Global Symbol.for identity registries are forbidden in neutral modules.",
        );
      }
      // No scope analysis: banned names cannot be local bindings either. Labels/member names
      // are inert; shorthand/computed values are checked. Strings/comments are scanner tokens.
      const inertLabel = next === ":" && ["{", ",", ";", "readonly"].includes(previous ?? "");
      // Password primitives are the sole Bun capability in this dependency-free leaf.
      // Require the complete direct call: no aliases, computed members, or object escape.
      const passwordCall =
        file === PATH("auth/password") &&
        token.text === "Bun" &&
        !propertyAccess &&
        next === "." &&
        tokens[index + 2]?.text === "password" &&
        tokens[index + 3]?.text === "." &&
        ["hash", "verify"].includes(tokens[index + 4]?.text ?? "") &&
        tokens[index + 5]?.text === "(" &&
        previous !== "new";
      if (
        !passwordCall &&
        tokenIsIdentifierOrKeyword(token.kind) &&
        AMBIENT_CAPABILITIES.has(token.value) &&
        !propertyAccess &&
        !inertLabel
      ) {
        report(
          token.start,
          "ambient-capability",
          `Ambient capability '${token.value}' is forbidden.`,
        );
      }
      if (
        file === CONTRACT_PATH &&
        !propertyAccess &&
        ["const", "let", "var", "function", "class", "enum", "namespace", "declare"].includes(
          token.text,
        )
      ) {
        report(
          token.start,
          "contract-value",
          "The contract permits only type/interface declarations and local type exports.",
        );
      }
      if (
        file === CONTRACT_PATH &&
        token.text === "export" &&
        !["type", "interface"].includes(next ?? "")
      ) {
        report(token.start, "contract-value", "Contract exports must explicitly be type-only.");
      }
    }
  }
  return diagnostics;
}

async function checkApplicationBoundaryFiles(root: string): Promise<BoundaryDiagnostic[]> {
  const entries = await Promise.all(
    Object.keys(neutralEdges).map(
      async (file) => [file, await readFile(resolve(root, file), "utf8")] as const,
    ),
  );
  const files = Object.fromEntries(entries);
  const runtime = files[RUNTIME_PATH] as string;
  const contract = files[CONTRACT_PATH] as string;
  delete files[RUNTIME_PATH];
  delete files[CONTRACT_PATH];
  return checkApplicationBoundary({ runtime, contract, modules: files });
}

if (import.meta.main) {
  try {
    const diagnostics = await checkApplicationBoundaryFiles(resolve(import.meta.dir, ".."));
    for (const issue of diagnostics)
      console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.rule}] ${issue.message}`);
    if (diagnostics.length) process.exitCode = 1;
    else
      console.log(
        "Application owner and migrated modules satisfy their explicit dependency boundaries.",
      );
  } catch (error) {
    console.error("Application boundary check could not inspect its required sources:", error);
    process.exitCode = 1;
  }
}

export type { ApplicationBoundarySources, BoundaryDiagnostic };
export { checkApplicationBoundary, checkApplicationBoundaryFiles };
