#!/usr/bin/env bun

/** Bounded M1 gate: no framework/service/transport dependency in the canonical owner. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createScanner, SyntaxKind, tokenIsIdentifierOrKeyword } from "typescript/unstable/ast";

const RUNTIME_PATH = "src/core/runtime/application.ts";
const CONTRACT_PATH = "src/core/contracts/application.ts";
const CONTRACT_IMPORTS = new Set(["../contracts/application", "../contracts/application.ts"]);
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

/** Accept only erased contract edges. Everything else needs an explicit boundary decision. */
function allowedTypeEdge(tokens: Token[], index: number): boolean {
  if (tokens[index + 1]?.text !== "type") return false;
  let cursor = index + 2;
  const clause: Token[] = [];
  while (cursor < tokens.length && tokens[cursor]?.text !== "from") {
    const token = tokens[cursor];
    if (
      !token ||
      !(tokenIsIdentifierOrKeyword(token.kind) || ["{", "}", ",", "*"].includes(token.text))
    )
      return false;
    clause.push(token);
    cursor++;
  }
  const specifier = tokens[cursor + 1];
  const following = tokens[cursor + 2];
  return (
    clause.length > 0 &&
    !!specifier &&
    specifier.kind === SyntaxKind.StringLiteral &&
    CONTRACT_IMPORTS.has(specifier.value) &&
    following?.text !== "with" &&
    following?.text !== "assert"
  );
}

function checkApplicationBoundary(sources: ApplicationBoundarySources): BoundaryDiagnostic[] {
  const diagnostics: BoundaryDiagnostic[] = [];
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
  for (const [file, source] of [
    [RUNTIME_PATH, sources.runtime],
    [CONTRACT_PATH, sources.contract],
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
        report(
          0,
          "dependency",
          `Executable dependency '${edge.path}' (${edge.kind}) is outside the M1 owner boundary.`,
        );
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
    const tokens = tokensOf(source);
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (!token) continue;
      const previous = tokens[index - 1]?.text;
      const next = tokens[index + 1]?.text;
      const propertyAccess = previous === "." || previous === "?.";
      if (token.text === "import" && !propertyAccess) {
        if (file !== RUNTIME_PATH || !allowedTypeEdge(tokens, index)) {
          report(
            token.start,
            "dependency",
            "Only erased type imports from ../contracts/application are allowed.",
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
            (file !== RUNTIME_PATH || !allowedTypeEdge(tokens, index))
          ) {
            report(
              token.start,
              file === CONTRACT_PATH ? "contract-value" : "dependency",
              "Only erased contract type reexports are allowed.",
            );
          }
        }
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
        [
          "const",
          "let",
          "var",
          "function",
          "class",
          "enum",
          "namespace",
          "declare",
          "import",
        ].includes(token.text)
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
  const [runtime, contract] = await Promise.all([
    readFile(resolve(root, RUNTIME_PATH), "utf8"),
    readFile(resolve(root, CONTRACT_PATH), "utf8"),
  ]);
  return checkApplicationBoundary({ runtime, contract });
}

if (import.meta.main) {
  try {
    const diagnostics = await checkApplicationBoundaryFiles(resolve(import.meta.dir, ".."));
    for (const issue of diagnostics)
      console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.rule}] ${issue.message}`);
    if (diagnostics.length) process.exitCode = 1;
    else console.log("Application owner and type contract satisfy the M1 import boundary.");
  } catch (error) {
    console.error("Application boundary check could not inspect its required sources:", error);
    process.exitCode = 1;
  }
}

export type { ApplicationBoundarySources, BoundaryDiagnostic };
export { checkApplicationBoundary, checkApplicationBoundaryFiles };
