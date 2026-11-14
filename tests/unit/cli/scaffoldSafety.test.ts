import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const file = Bun.file(join(workspace, "src/modules/product/factory.ts"));
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
  expect(await Bun.file(join(workspace, "src/modules/product/factory.ts")).text()).toContain(
    'from "../../models/Product.ts"',
  );
});
