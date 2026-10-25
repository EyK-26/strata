import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldCommands } from "@getstrata/cli/scaffold";
import { renderCliRegisterTs } from "../../../packages/strata-starter/src/renderCli";

async function workspace(
  run: (root: string, command: (...args: string[]) => Promise<void>) => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "strata-model-generator-")));
  const cwd = process.cwd();
  try {
    process.chdir(root);
    const loader = scaffoldCommands["make:model"];
    expect(typeof loader).toBe("function");
    if (!loader) throw new Error("make:model must be part of the public scaffold registry.");
    const command = await loader();
    await run(root, async (...args) => {
      await command(...args);
    });
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
}

test("make:model generates a discoverable declarative model without migrations or a repository", () =>
  workspace(async (root, command) => {
    await mkdir(join(root, "src/models"), { recursive: true });
    const register = join(root, "src/models/register.ts");
    await writeFile(register, "// app-owned orchestration\n");
    await command("Invoice");
    const code = await readFile(join(root, "src/models/Invoice.ts"), "utf8");
    expect(code).toContain('from "@getstrata/core/database/model"');
    expect(code).toContain("class Invoice extends defineModel(");
    expect(code).toContain('name: "invoices"');
    expect(code).toContain("static override $timestamps = false");
    expect(await readFile(register, "utf8")).toBe("// app-owned orchestration\n");
    expect(await Bun.file(join(root, "src/modules/invoice/repository.ts")).exists()).toBe(false);
    expect(existsSync(join(root, "src/db/migrations"))).toBe(false);
  }));

test("make:model supports nested names and explicit legacy table/string key metadata", () =>
  workspace(async (root, command) => {
    await command(
      "Billing/Invoice",
      "--table=legacy_invoice",
      "--primary-key=invoice_id",
      "--key-type=string",
    );
    const code = await readFile(join(root, "src/models/Billing/Invoice.ts"), "utf8");
    expect(code).toContain("class BillingInvoice extends defineModel(");
    expect(code).toContain("invoice_id: string");
    expect(code).toContain('name: "legacy_invoice"');
    expect(code).toContain('primaryKey: "invoice_id"');
    expect(code).toContain('static override $fillable = ["invoice_id"] as const');
  }));

test("make:model refuses collisions and keeps the original bytes", () =>
  workspace(async (root, command) => {
    await command("Invoice");
    const path = join(root, "src/models/Invoice.ts");
    await writeFile(path, "// handwritten model");
    await expect(command("invoice")).rejects.toThrow(/already exists/i);
    expect(await readFile(path, "utf8")).toBe("// handwritten model");
  }));

test("make:model rejects symlinked output parents and leaf files", () =>
  workspace(async (root, command) => {
    await mkdir(join(root, "outside"));
    await mkdir(join(root, "src"));
    await symlink(join(root, "outside"), join(root, "src/models"));
    await expect(command("Invoice")).rejects.toThrow(/symbolic link/i);
    expect(await Bun.file(join(root, "outside/Invoice.ts")).exists()).toBe(false);
    await rm(join(root, "src/models"));
    await mkdir(join(root, "src/models"));
    const target = join(root, "outside/target.ts");
    await writeFile(target, "keep");
    await symlink(target, join(root, "src/models/Invoice.ts"));
    await expect(command("Invoice")).rejects.toThrow(/already exists|symbolic link/i);
    expect(await readFile(target, "utf8")).toBe("keep");
  }));

for (const name of [
  "../Lead",
  "/absolute",
  "A/../Lead",
  "A//Lead",
  "A\\Lead",
  "!!!",
  "1Lead",
  "Lead.ts",
  "register",
  "index",
]) {
  test(`make:model rejects unsafe or reserved name ${JSON.stringify(name)}`, () =>
    workspace(async (_root, command) => {
      await expect(command(name)).rejects.toThrow(/name|path|reserved/i);
    }));
}

for (const option of [
  "--table=a;DROP",
  "--table=",
  "--primary-key=id.name",
  "--primary-key=__proto__",
  "--key-type=uuid",
  "--force",
  "--migration",
]) {
  test(`make:model rejects unsupported option ${option}`, () =>
    workspace(async (_root, command) => {
      await expect(command("Lead", option)).rejects.toThrow(/option|table|key|identifier/i);
    }));
}

test("make:model help explains separate migrations without creating files", () =>
  workspace(async (root, command) => {
    const logs: string[] = [];
    const previous = console.log;
    try {
      console.log = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };
      await command("--help");
    } finally {
      console.log = previous;
    }
    expect(logs.join("\n")).toContain("--key-type");
    expect(logs.join("\n")).toContain("make:migration");
    expect(existsSync(join(root, "src/models"))).toBe(false);
  }));

test("fresh generated CLI registries expose the model command", () => {
  expect(renderCliRegisterTs()).toContain(
    '"make:model": async () => (await import("@getstrata/cli/scaffold")).makeModelCommand',
  );
});
