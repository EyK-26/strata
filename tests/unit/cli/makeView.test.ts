import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldCommands } from "@getstrata/cli/scaffold";
import { EtaViewEngine } from "@getstrata/core/view";
import { renderCliRegisterTs } from "../../../packages/strata-starter/src/renderCli";

async function workspace(
  run: (root: string, command: (...args: string[]) => Promise<void>) => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "strata-view-generator-")));
  const cwd = process.cwd();
  try {
    process.chdir(root);
    const loader = scaffoldCommands["make:view"];
    expect(typeof loader).toBe("function");
    if (!loader) throw new Error("make:view must be in the public scaffold registry.");
    const command = await loader();
    await run(root, async (...args) => {
      await command(...args);
    });
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
}

test("make:view uses resources/views by default and renders escaped Eta with accents", () =>
  workspace(async (root, command) => {
    await command("reports/Summary");
    const engine = new EtaViewEngine(join(root, "resources/views"));
    const html = await engine.render(
      "reports/summary",
      { title: "Příliš žluťoučký", message: "<script>alert(1)</script>" },
      { layout: false },
    );
    expect(html).toContain("Příliš žluťoučký");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(existsSync(join(root, "src"))).toBe(false);
  }));

test("make:view follows existing app views preference, supports .eta, partials and numeric errors", () =>
  workspace(async (root, command) => {
    await mkdir(join(root, "views"));
    await mkdir(join(root, "resources/views"), { recursive: true });
    await command("emails/welcome.eta");
    await command("partials/_card");
    await command("errors/404");
    for (const name of ["emails/welcome", "partials/_card", "errors/404"])
      expect(existsSync(join(root, "views", `${name}.eta`))).toBe(true);
    expect(existsSync(join(root, "resources/views/emails/welcome.eta"))).toBe(false);
  }));

test("make:view refuses duplicate output and keeps existing bytes", () =>
  workspace(async (root, command) => {
    await command("welcome");
    const path = join(root, "resources/views/welcome.eta");
    await writeFile(path, "<p>Handwritten</p>");
    await expect(command("welcome.eta")).rejects.toThrow(/already exists/i);
    expect(await readFile(path, "utf8")).toBe("<p>Handwritten</p>");
  }));

test("make:view refuses live and dangling view-root symlinks", () =>
  workspace(async (root, command) => {
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, "views"));
    await expect(command("welcome")).rejects.toThrow(/symbolic link/i);
    expect(existsSync(join(root, "outside/welcome.eta"))).toBe(false);
    await rm(join(root, "outside"), { recursive: true });
    await expect(command("welcome")).rejects.toThrow(/symbolic link/i);
    expect(existsSync(join(root, "resources/views/welcome.eta"))).toBe(false);
  }));

for (const name of [
  "../welcome",
  "/absolute",
  "a/../welcome",
  "a//welcome",
  "a\\b",
  "<script>",
  "foo.txt",
  "foo.eta.ts",
  ".eta",
]) {
  test(`make:view rejects unsafe name ${JSON.stringify(name)}`, () =>
    workspace(async (_root, command) => {
      await expect(command(name)).rejects.toThrow(/name|path/i);
    }));
}

test("make:view refuses unknown options and documents its limited scope", () =>
  workspace(async (root, command) => {
    await expect(command("welcome", "--force")).rejects.toThrow(/option/i);
    const previous = console.log,
      logs: string[] = [];
    try {
      console.log = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };
      await command("--help");
    } finally {
      console.log = previous;
    }
    expect(logs.join("\n")).toContain("resources/views");
    expect(logs.join("\n")).toContain("routes");
    expect(existsSync(join(root, "views"))).toBe(false);
    expect(existsSync(join(root, "resources"))).toBe(false);
  }));

test("fresh generated CLI registries expose the view command", () => {
  expect(renderCliRegisterTs()).toContain(
    '"make:view": async () => (await import("@getstrata/cli/scaffold")).makeViewCommand',
  );
});
