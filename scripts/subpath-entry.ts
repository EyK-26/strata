const transpiler = new Bun.Transpiler({ loader: "ts" });

/** Star re-exports omit defaults; preserve actual runtime defaults without inventing type-only values. */
export function renderSubpathEntry(source: string, importPath: string): string {
  const exports = transpiler.scan(transpiler.transformSync(source)).exports;
  const quoted = JSON.stringify(importPath);
  return `export * from ${quoted};\n${exports.includes("default") ? `export { default } from ${quoted};\n` : ""}`;
}
