import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeModuleCommand } from "../../../packages/strata-cli/src/scaffold/makeModule";
import { renderModuleScaffold } from "../../../packages/strata-cli/src/scaffold/renderModule";
import historical from "../../fixtures/scaffolds/module-rendering.sha256.json";
import baselines from "../../fixtures/scaffolds/module-rendering-canonical.sha256.json";
import { captureConsole } from "./helpers";

for (const { profile, files: expected } of baselines) {
  test(`module rendering matches canonical full-file hashes: ${profile.name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-module-rendering-"));
    const previousCwd = process.cwd();
    const output = captureConsole();
    try {
      await mkdir(join(directory, "src/models"), { recursive: true });
      await writeFile(join(directory, "src/models/register.ts"), "// Existing model registry\n");
      if (profile.views) await mkdir(join(directory, "views"));
      process.chdir(directory);
      await makeModuleCommand(...(profile.withWeb ? ["--with-web"] : []), profile.name);
      const actual: Record<string, unknown> = {};
      async function visit(path: string): Promise<void> {
        for (const item of await readdir(path, { withFileTypes: true })) {
          const full = join(path, item.name);
          if (item.isDirectory()) await visit(full);
          else {
            const relative = full.slice(directory.length + 1);
            actual[relative] = createHash("sha256")
              .update(await readFile(full))
              .digest("hex");
          }
        }
      }
      await visit(directory);
      expect(actual).toEqual(expected);
    } finally {
      output.restore();
      process.chdir(previousCwd);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("rendering produces independent in-memory manifests without writing to disk", () => {
  const options = {
    moduleSlug: "item",
    moduleName: "Item",
    moduleIdentifier: "item",
    withWeb: true,
  };
  const first = renderModuleScaffold(options);
  const originalController = first.files.get("controller.ts");
  first.files.set("controller.ts", "caller-edited");
  const next = renderModuleScaffold(options);
  expect(next.files.get("controller.ts")).toBe(originalController);
  expect(next.webFiles.has("webController.ts")).toBe(true);
  expect(next.viewFiles.has("index.eta")).toBe(true);
});

test("canonical module inventory retains the three existing profiles", () => {
  expect(baselines).toHaveLength(3);
  expect(baselines.map(({ profile }) => profile)).toEqual(historical.map(({ profile }) => profile));
});

test("emitted module declaration typechecks and carries its genuine typed policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-module-provider-"));
  const repository = join(import.meta.dir, "../../..");
  try {
    const rendered = renderModuleScaffold({
      moduleSlug: "invoice",
      moduleName: "Invoice",
      moduleIdentifier: "invoice",
      withWeb: true,
    });
    for (const [name, source] of [...rendered.files, ...rendered.webFiles]) {
      await writeFile(join(directory, name), source);
    }
    const consumer = `import module from "./index";
import InvoicePolicy from "./policy";
import { PolicyGate } from "@getstrata/core/auth/policy";
const gate = new PolicyGate();
const policy = module.policies?.invoice;
if (!(policy instanceof InvoicePolicy)) throw new Error("Generated module lost genuine policy construction.");
for (const [name, policy] of Object.entries(module.policies ?? {})) gate.register(name,policy);
if (!(await gate.allows("invoice", "create", { id: 1, role: "member" }))) throw new Error("Generated module did not declare typed policy.");
console.log("typed generated policy registered");
`;
    await writeFile(join(directory, "consumer.ts"), consumer);
    const config = join(directory, "tsconfig.json");
    await writeFile(
      config,
      JSON.stringify({
        extends: join(repository, "tsconfig.json"),
        compilerOptions: { typeRoots: [join(repository, "node_modules/@types")] },
        include: [],
        files: [join(directory, "consumer.ts")],
      }),
    );
    const checked = Bun.spawn(
      [join(repository, "node_modules/.bin/tsc"), "--noEmit", "-p", config],
      { cwd: repository, stdout: "pipe", stderr: "pipe" },
    );
    const [typeCode, typeOut, typeErr] = await Promise.all([
      checked.exited,
      new Response(checked.stdout).text(),
      new Response(checked.stderr).text(),
    ]);
    expect({ code: typeCode, output: typeOut + typeErr }).toEqual({ code: 0, output: "" });
    const runtime = Bun.spawn(
      [
        process.execPath,
        "--tsconfig-override",
        join(repository, "tsconfig.json"),
        join(directory, "consumer.ts"),
      ],
      { cwd: repository, stdout: "pipe", stderr: "pipe" },
    );
    const [runCode, runOut, runErr] = await Promise.all([
      runtime.exited,
      new Response(runtime.stdout).text(),
      new Response(runtime.stderr).text(),
    ]);
    expect({ code: runCode, error: runErr, output: runOut.trim() }).toEqual({
      code: 0,
      error: "",
      output: "typed generated policy registered",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
