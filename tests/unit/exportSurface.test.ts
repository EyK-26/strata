import { expect, test } from "bun:test";
import { parseDeclaredValueExports } from "../../scripts/export-surface.ts";

test("package verifier retains named exports and detects value defaults", () => {
  expect(
    [
      ...parseDeclaredValueExports(`
    declare class Repository {}
    export { Repository };
    export default Repository;
  `),
    ].sort(),
  ).toEqual(["Repository", "default"]);
  expect([...parseDeclaredValueExports("export default class Repository {}")]).toEqual(["default"]);
  expect([...parseDeclaredValueExports("export default function create(): void;")]).toEqual([
    "default",
  ]);
  expect([
    ...parseDeclaredValueExports("declare const provider: object; export { provider as default };"),
  ]).toEqual(["default"]);
});

test("package verifier does not require runtime defaults for type-only declarations", () => {
  for (const source of [
    "export default interface Shape {}",
    "interface Shape {} export default Shape;",
    "type Shape = { id: number }; export default Shape;",
    "interface Shape {} export { Shape as default };",
    "declare class Repository {} export type { Repository as default };",
    "declare class Repository {} export { type Repository as default };",
    "// export default Missing;\n/* export default AlsoMissing; */",
  ])
    expect([...parseDeclaredValueExports(source)]).toEqual([]);
  expect([
    ...parseDeclaredValueExports(
      "interface Merged {} declare class Merged {} export default Merged;",
    ),
  ]).toEqual(["default"]);
});

test("subpath generation preserves runtime defaults and omits erased type defaults", async () => {
  const { renderSubpathEntry } = await import("../../scripts/subpath-entry.ts");
  expect(renderSubpathEntry("class Repository {} export default Repository;", "./source.ts")).toBe(
    'export * from "./source.ts";\nexport { default } from "./source.ts";\n',
  );
  expect(renderSubpathEntry("export { default } from './other';", "./source.ts")).toContain(
    'export { default } from "./source.ts"',
  );
  expect(renderSubpathEntry("export default interface Shape {}", "./source.ts")).toBe(
    'export * from "./source.ts";\n',
  );
  for (const source of [
    "interface Shape {} export default Shape;",
    "type Shape = {id:number}; export {Shape as default};",
  ]) {
    expect(renderSubpathEntry(source, "./source.ts")).toBe('export * from "./source.ts";\n');
  }
  expect(renderSubpathEntry("export class Repository {}", "./source.ts")).toBe(
    'export * from "./source.ts";\n',
  );
});

test("shared default exports alias the canonical bundle without duplicating class definitions", async () => {
  const { renderCoreSharedShim } = await import("../../scripts/core-shared-subpaths.ts");
  expect(renderCoreSharedShim("database/baseRepository")).toBe(
    'export * from "../../index.js";\nexport { BaseRepository as default } from "../../index.js";\n',
  );
  expect(renderCoreSharedShim("database/model")).toBe('export * from "../../index.js";\n');
});
