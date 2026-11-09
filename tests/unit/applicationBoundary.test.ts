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
    ["src/core/config/configSnapshot.ts", "const input = globalThis.config;"],
  ])("rejects ambient ownership in %s", (file, source) => {
    expect(inspectModule(file, source).some((issue) => issue.rule === "ambient-capability")).toBe(
      true,
    );
  });
});
