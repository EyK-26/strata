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
