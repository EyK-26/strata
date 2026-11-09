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
      "runtime/serviceGraph",
      "runtime/resourceJournal",
      "runtime/executionContext",
      "config/configSnapshot",
    ],
    types: ["contracts/application", "contracts/services", "contracts/token"],
  },
  [CONTRACT_PATH]: { values: [], types: ["contracts/token", "contracts/services"] },
  [PATH("runtime/resourceJournal")]: { values: [], types: ["contracts/application"] },
  [PATH("runtime/executionContext")]: {
    values: ["config/configSnapshot"],
    types: ["contracts/application"],
  },
  [PATH("contracts/executionContext")]: {
    values: ["contracts/token"],
    types: ["contracts/application"],
  },
  [PATH("runtime/serviceGraph")]: {
    values: ["contracts/token", "contracts/services", "contracts/executionContext"],
    types: [
      "contracts/container",
      "contracts/services",
      "contracts/token",
      "contracts/application",
    ],
  },
  [PATH("contracts/token")]: { values: [], types: [] },
  [PATH("contracts/services")]: { values: ["contracts/token"], types: ["contracts/token"] },
  [PATH("contracts/container")]: {
    values: ["contracts/token", "contracts/services"],
    types: ["contracts/token", "contracts/services"],
  },
  [PATH("view/tokens")]: { values: ["contracts/token"], types: ["view/viewRenderer"] },
  [PATH("cache/tokens")]: { values: ["contracts/token"], types: ["../types/services"] },
  [PATH("config/configSnapshot")]: { values: [], types: ["contracts/application"] },
  [PATH("config/applicationConfig")]: {
    values: ["config/configSnapshot", "config/envSchema"],
    types: ["contracts/application", "config/envSchema"],
  },
  // Legacy compatibility facade: preserve only its enumerated type debt, never runtime ownership.
  [PATH("contracts/serviceTokens")]: {
    values: ["contracts/token", "cache/tokens"],
    types: [
      "auth/abilityChecker",
      "http/throttleMiddleware",
      "tenant/tenantMiddleware",
      "contracts/authUserDirectory",
      "contracts/container",
    ],
  },
};
const canonicalValues = new Set(
  [
    "contracts/token",
    "contracts/container",
    "contracts/services",
    "contracts/executionContext",
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
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
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
function resolveEdge(file: string, edge: string): string | undefined {
  if (edge.startsWith("@getstrata/core/"))
    return PATH(edge.slice("@getstrata/core/".length).replace(/\.ts$/, ""));
  if (edge.startsWith(".")) {
    const path = posix.normalize(posix.join(posix.dirname(file), edge));
    return path.endsWith(".ts") ? path : `${path}.ts`;
  }
  return undefined;
}
function allows(file: string, edge: DependencyEdge): boolean {
  const rules = neutralEdges[file];
  const target = resolveEdge(file, edge.path);
  if (!rules || !target) return false;
  const allowed = edge.typeOnly ? [...rules.types, ...rules.values] : rules.values;
  if (!allowed.map(PATH).includes(target)) return false;
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
    try {
      const emitted = transpiler.transformSync(source);
      // Bun validates syntax and scans executable imports, including require and dynamic import.
      for (const edge of transpiler.scan(source).imports) {
        if (
          edge.kind !== "import-statement" ||
          !allows(file, { path: edge.path, typeOnly: false })
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
    const tokens = tokensOf(source);
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (!token) continue;
      const previous = tokens[index - 1]?.text;
      const next = tokens[index + 1]?.text;
      const propertyAccess = previous === "." || previous === "?.";
      if (token.text === "import" && !propertyAccess) {
        const edge = dependencyEdge(tokens, index);
        if (!edge || !allows(file, edge)) {
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
      if (
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
      console.log("Application owner and type contract satisfy the M2.1 neutral module boundary.");
  } catch (error) {
    console.error("Application boundary check could not inspect its required sources:", error);
    process.exitCode = 1;
  }
}

export type { ApplicationBoundarySources, BoundaryDiagnostic };
export { checkApplicationBoundary, checkApplicationBoundaryFiles };
