#!/usr/bin/env bun
/** Opt-in compiler feasibility: declarations only, never application execution. */
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { version as typescriptVersion } from "typescript";

interface ContractCase {
  name: string;
  classification:
    | "proposed-positive"
    | "proposed-rejection"
    | "known-type-limit"
    | "current-compatibility";
  source: string;
  expectedCodes: number[];
}
interface Diagnostic {
  file?: string;
  line?: number;
  code: number;
  message: string;
}

const root = resolve(import.meta.dir, "..");
const output = process.argv[2];
assert.ok(output && isAbsolute(output), "Provide a new absolute output directory.");
await mkdir(output); // Refuse an existing receipt; never replace a historical run.
const fixtures = join(import.meta.dir, "fixtures/m1-http-contracts");
const casesText = await readFile(join(fixtures, "cases.json"), "utf8");
const cases: ContractCase[] = JSON.parse(casesText);
assert.ok(cases.length > 0);
assert.equal(new Set(cases.map((item) => item.name)).size, cases.length);
const inputs = join(output, "inputs");
await mkdir(inputs);
await symlink(join(root, "node_modules"), join(output, "node_modules"), "dir");
await copyFile(join(fixtures, "proposal.ts"), join(inputs, "proposal.ts"));
const files = new Map(cases.map((item, index) => [join(inputs, `probe-${index}.ts`), item.source]));
for (const [path, source] of files) await writeFile(path, source, { flag: "wx" });
const config = join(output, "tsconfig.json");
await writeFile(
  config,
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      files: [...files.keys()],
      include: [],
      exclude: [],
    },
    null,
    2,
  ),
  { flag: "wx" },
);

async function compiler(...arguments_: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      join(root, "node_modules/typescript/bin/tsc"),
      "--project",
      config,
      "--pretty",
      "false",
      ...arguments_,
    ],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
// Keep all inherited strictness and actual package resolution. No legacy API or compiler alias.
const configuration = await compiler("--showConfig");
await writeFile(join(output, "effective-config.log"), configuration.stdout + configuration.stderr, {
  flag: "wx",
});
assert.equal(configuration.exitCode, 0);
const checked = await compiler("--noEmit", "--noErrorTruncation");
const raw = checked.stdout + checked.stderr;
await writeFile(join(output, "compiler.log"), raw, { flag: "wx" });
const diagnostics: Diagnostic[] = [];
const unparsedErrors: string[] = [];
for (const line of raw.split("\n")) {
  if (!line.includes("error TS")) continue;
  const match = /^(.+)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line.trimEnd());
  if (!match) {
    unparsedErrors.push(line);
    continue;
  }
  diagnostics.push({
    file: resolve(root, match[1] ?? ""),
    line: Number(match[2]),
    code: Number(match[4]),
    message: match[5] ?? "",
  });
}
const unrelated = diagnostics.filter((item) => !item.file || !files.has(item.file));
const results = [...files].map(([path, source], index) => {
  const item = cases[index];
  assert.ok(item);
  const observed = diagnostics.filter((diagnostic) => diagnostic.file === path);
  const codes = observed.map((diagnostic) => diagnostic.code).sort((a, b) => a - b);
  const expected = [...item.expectedCodes].sort((a, b) => a - b);
  return {
    name: item.name,
    classification: item.classification,
    expectedCodes: expected,
    observedCodes: codes,
    passed: JSON.stringify(codes) === JSON.stringify(expected),
    source,
    diagnostics: observed,
  };
});
const listed = await compiler("--listFilesOnly");
await writeFile(join(output, "compiler-inputs.log"), listed.stdout + listed.stderr, { flag: "wx" });
assert.equal(listed.exitCode, 0);
const nativeTypes = listed.stdout
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line.endsWith("/bun-types/serve.d.ts"));
assert.ok(nativeTypes, "Record the native server declaration actually used by this compiler.");
const proposal = await readFile(join(fixtures, "proposal.ts"), "utf8");
const sourceHead = Bun.spawnSync(
  ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "rev-parse", "HEAD"],
  { cwd: root },
);
assert.equal(sourceHead.exitCode, 0);
const compilerExitMatchesDiagnostics = diagnostics.length
  ? [1, 2].includes(checked.exitCode)
  : checked.exitCode === 0;
const result = {
  status:
    !unrelated.length &&
    !unparsedErrors.length &&
    compilerExitMatchesDiagnostics &&
    results.every((item) => item.passed)
      ? "PASS"
      : "FAIL",
  runtime: Bun.version,
  typescript: typescriptVersion,
  bunTypes: JSON.parse(await readFile(join(dirname(nativeTypes), "package.json"), "utf8")).version,
  sourceHead: sourceHead.stdout.toString().trim(),
  inputs: {
    proposalSha256: new Bun.CryptoHasher("sha256").update(proposal).digest("hex"),
    casesSha256: new Bun.CryptoHasher("sha256").update(casesText).digest("hex"),
    probeSha256: new Bun.CryptoHasher("sha256")
      .update(await readFile(import.meta.path))
      .digest("hex"),
    nativeServerDeclarationSha256: new Bun.CryptoHasher("sha256")
      .update(await readFile(nativeTypes))
      .digest("hex"),
    baseConfigurationSha256: new Bun.CryptoHasher("sha256")
      .update(await readFile(join(root, "tsconfig.json")))
      .digest("hex"),
  },
  compilerExitCode: checked.exitCode,
  compilerExitMatchesDiagnostics,
  effectiveConfiguration: JSON.parse(configuration.stdout),
  unrelatedDiagnostics: unrelated,
  unparsedErrors,
  executed: results.length,
  passed: results.filter((item) => item.passed).length,
  failed: results.filter((item) => !item.passed).length,
  skipped: 0,
  results,
  limits:
    "Compiler feasibility only; no runtime factory, accepted exports, startup validator, provider, browser or migration acceptance.",
};
await writeFile(join(output, "results.json"), `${JSON.stringify(result, null, 2)}\n`, {
  flag: "wx",
});
console.log(
  JSON.stringify({
    status: result.status,
    executed: result.executed,
    passed: result.passed,
    failed: result.failed,
    skipped: 0,
  }),
);
assert.equal(unrelated.length, 0, "Unexpected diagnostics outside the deliberate probe files.");
assert.equal(unparsedErrors.length, 0, "Every compiler error must be accounted for.");
assert.equal(compilerExitMatchesDiagnostics, true);
assert.equal(result.failed, 0, "Every case must produce its exact expected diagnostic codes.");
