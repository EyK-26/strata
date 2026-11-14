import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  makeFactoryCommand,
  makeJobCommand,
  makeModelCommand,
  makeModuleCommand,
  scaffoldCommands,
} from "../../../packages/strata-cli/src/scaffold";

const original = process.cwd();
let workspace: string;
afterEach(async () => {
  process.chdir(original);
  if (workspace) await rm(workspace, { recursive: true, force: true });
});
async function setup() {
  workspace = await mkdtemp(join(tmpdir(), "strata-scaffold-safety-"));
  process.chdir(workspace);
}

test("all scaffold help and malformed arguments avoid filesystem writes", async () => {
  await setup();
  for (const [name, loader] of Object.entries(scaffoldCommands)) {
    const command = await loader();
    await command("--help");
    await expect(Promise.resolve().then(() => command("!!!"))).rejects.toThrow();
    await expect(Promise.resolve().then(() => command("Product", "--unknown"))).rejects.toThrow();
    await expect(Promise.resolve().then(() => command("../Product"))).rejects.toThrow();
    expect(await readdir(workspace)).toEqual([]);
    expect(name).toStartWith("make:");
  }
});
test("model then factory imports the generated model and preserves existing output", async () => {
  await setup();
  await makeModelCommand("Product");
  await makeFactoryCommand("Product");
  const file = Bun.file(join(workspace, "src/db/factories/ProductFactory.ts"));
  const source = await file.text();
  expect(source).toContain('from "../../models/Product.ts"');
  expect(await Bun.file(join(workspace, "src/models/Product.ts")).exists()).toBe(true);
  await expect(makeFactoryCommand("Product")).rejects.toThrow("already exists");
  expect(await file.text()).toBe(source);
});
test("module uses configured directory and ordinary model without pass-through service or provider", async () => {
  await setup();
  await writeFile(
    join(workspace, "strata.config.ts"),
    'export default { modulesDirectory: "app/features" };',
  );
  await makeModuleCommand("Product");
  const files = await readdir(join(workspace, "app/features/product"));
  expect(files).toContain("model.ts");
  expect(files).not.toContain("repository.ts");
  expect(files).not.toContain("service.ts");
  expect(files).not.toContain("provider.ts");
  expect(await Bun.file(join(workspace, "app/features/product/index.ts")).text()).toContain(
    'policies: { "product": new ProductPolicy() }',
  );
});
test("scaffold rejects output symlinks before writing", async () => {
  await setup();
  await symlink(tmpdir(), join(workspace, "src"));
  await expect(makeJobCommand("Product")).rejects.toThrow("symbolic link");
});

test("package registry runs scaffold commands without generated registration", async () => {
  await setup();
  const { runCli } = await import("../../../packages/strata-cli/src/runCli");
  expect(
    await runCli({
      cwd: workspace,
      argv: ["make:job", "--help"],
      skipBoot: true,
      exitProcess: false,
    }),
  ).toBe(0);
  expect(await readdir(workspace)).toEqual([]);
  expect(
    await runCli({
      cwd: workspace,
      argv: ["make:model", "Product"],
      skipBoot: true,
      exitProcess: false,
    }),
  ).toBe(0);
  expect(
    await runCli({
      cwd: workspace,
      argv: ["make:factory", "Product"],
      skipBoot: true,
      exitProcess: false,
    }),
  ).toBe(0);
  expect(await Bun.file(join(workspace, "src/db/factories/ProductFactory.ts")).text()).toContain(
    'from "../../models/Product.ts"',
  );
});

test("model, factory and module journey preserves factory and typechecks emitted sources", async () => {
  await setup();
  const repository = resolve(import.meta.dir, "../../..");
  await makeModelCommand("Product");
  await makeFactoryCommand("Product");
  const factory = join(workspace, "src/db/factories/ProductFactory.ts");
  const before = await Bun.file(factory).text();
  await makeModuleCommand("Product");
  expect(await Bun.file(factory).text()).toBe(before);
  const config = JSON.parse(await readFile(join(repository, "tsconfig.json"), "utf8"));
  for (const [alias, paths] of Object.entries(config.compilerOptions.paths))
    config.compilerOptions.paths[alias] = (paths as string[]).map((path) =>
      resolve(repository, path),
    );
  config.compilerOptions.typeRoots = [join(repository, "node_modules/@types")];
  config.include = ["src/**/*.ts"];
  await writeFile(join(workspace, "tsconfig.json"), JSON.stringify(config));
  const child = Bun.spawn(
    [
      process.execPath,
      join(repository, "node_modules/typescript/bin/tsc"),
      "--project",
      join(workspace, "tsconfig.json"),
      "--noEmit",
    ],
    { cwd: workspace, stdout: "pipe", stderr: "pipe" },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
});

test("missing factory models fail before creating files", async () => {
  await setup();
  await expect(makeFactoryCommand("Missing")).rejects.toThrow("was not found");
  expect(await readdir(workspace)).toEqual([]);
});

test("nested model factories use matching class names and stay outside module discovery", async () => {
  await setup();
  await makeModelCommand("Native/Lead", "--key-type=string");
  await makeFactoryCommand("Native/Lead");
  const source = await Bun.file(join(workspace, "src/db/factories/Native/LeadFactory.ts")).text();
  expect(source).toContain("NativeLeadRecord");
  expect(source).toContain('from "../../../models/Native/Lead.ts"');
  expect(await Bun.file(join(workspace, "src/modules/native-lead/factory.ts")).exists()).toBe(
    false,
  );
});

test("factory resolves configured module records and prefers standalone models", async () => {
  await setup();
  await writeFile(
    join(workspace, "strata.config.ts"),
    'export default { modulesDirectory: "app/features" };',
  );
  await makeModuleCommand("Widget");
  await makeFactoryCommand("Widget");
  expect(await Bun.file(join(workspace, "src/db/factories/WidgetFactory.ts")).text()).toContain(
    'from "../../../app/features/widget/types.ts"',
  );
  await makeModelCommand("Product");
  await makeModuleCommand("Product");
  await makeFactoryCommand("Product");
  expect(await Bun.file(join(workspace, "src/db/factories/ProductFactory.ts")).text()).toContain(
    'from "../../models/Product.ts"',
  );
});

test("factory accepts module model record exports without a legacy types file", async () => {
  await setup();
  await mkdir(join(workspace, "src/modules/widget"), { recursive: true });
  await writeFile(
    join(workspace, "src/modules/widget/model.ts"),
    "export interface WidgetRecord { id: number; }",
  );
  await makeFactoryCommand("Widget");
  expect(await Bun.file(join(workspace, "src/db/factories/WidgetFactory.ts")).text()).toContain(
    'from "../../modules/widget/model.ts"',
  );
});
