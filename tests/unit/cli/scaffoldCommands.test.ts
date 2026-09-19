import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirectory } from "@getstrata/cli/scaffold/utils";
import { captureConsole, repoRoot } from "./helpers";

const tempDirectories: string[] = [];
let modulesRoot = "";
let migrationsRoot = "";

async function withTempWorkspace(
  run: (workspace: string) => Promise<void>,
  options: { chdir?: boolean } = { chdir: true },
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "strata-cli-scaffold-"));
  tempDirectories.push(workspace);
  modulesRoot = join(workspace, "src", "modules");
  migrationsRoot = join(workspace, "src", "db", "migrations");
  await mkdir(modulesRoot, { recursive: true });
  await mkdir(migrationsRoot, { recursive: true });

  const previousCwd = process.cwd();

  if (options.chdir) {
    process.chdir(workspace);
  }

  try {
    await run(workspace);
  } finally {
    process.chdir(previousCwd);
  }
}

afterEach(async () => {
  process.chdir(repoRoot);

  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("makeModuleCommand", () => {
  test("creates a module scaffold in a temp directory", async () => {
    await withTempWorkspace(async (_workspace) => {
      const { makeModuleCommand } = await import("@getstrata/cli/scaffold/makeModule");
      const output = captureConsole();

      try {
        await makeModuleCommand("billing widget");
      } finally {
        output.restore();
      }

      const moduleDirectory = join(modulesRoot, "billing-widget");
      expect(await Bun.file(join(moduleDirectory, "index.ts")).exists()).toBe(true);
      expect(await Bun.file(join(moduleDirectory, "controller.ts")).exists()).toBe(true);
      expect(await Bun.file(join(moduleDirectory, "policy.ts")).exists()).toBe(true);
      expect(output.logs.some((line) => line.includes("Created module scaffold in:"))).toBe(true);
      expect(output.logs.some((line) => line.includes(moduleDirectory))).toBe(true);
    });
  });

  test("creates web scaffolds when --with-web is passed", async () => {
    await withTempWorkspace(async () => {
      const { makeModuleCommand } = await import("@getstrata/cli/scaffold/makeModule");
      const output = captureConsole();

      try {
        await makeModuleCommand("--with-web", "release note");
      } finally {
        output.restore();
      }

      const moduleDirectory = join(modulesRoot, "release-note");
      expect(await Bun.file(join(moduleDirectory, "webRoutes.ts")).exists()).toBe(true);
      expect(
        await Bun.file(join(process.cwd(), "resources/views/release-notes/index.eta")).exists(),
      ).toBe(true);
      expect(output.logs.some((line) => line.includes("Created web view scaffold"))).toBe(true);
    });
  });

  test("requires a module name", async () => {
    const { makeModuleCommand } = await import("@getstrata/cli/scaffold/makeModule");

    await expect(makeModuleCommand()).rejects.toThrow("make:module requires a name.");
  });

  test("rejects duplicate modules", async () => {
    await withTempWorkspace(async () => {
      const { makeModuleCommand } = await import("@getstrata/cli/scaffold/makeModule");

      await makeModuleCommand("duplicate-module");
      await expect(makeModuleCommand("duplicate-module")).rejects.toThrow("Module already exists:");
    });
  });

  test("rejects invalid module names", async () => {
    const { makeModuleCommand } = await import("@getstrata/cli/scaffold/makeModule");

    await expect(makeModuleCommand("!!!")).rejects.toThrow(
      "make:module requires a valid module name.",
    );
  });
});

describe("makeMigrationCommand", () => {
  test("creates a migration file in the temp migrations directory", async () => {
    await withTempWorkspace(async () => {
      const { makeMigrationCommand } = await import("@getstrata/cli/scaffold/makeMigration");
      const output = captureConsole();

      try {
        await makeMigrationCommand("add widgets table");
      } finally {
        output.restore();
      }

      const files = await Array.fromAsync(new Bun.Glob("*.ts").scan(migrationsRoot));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/_add_widgets_table\.ts$/);
      expect(output.logs[0]).toMatch(/^Created migration: /);
    });
  });

  test("requires a migration name", async () => {
    const { makeMigrationCommand } = await import("@getstrata/cli/scaffold/makeMigration");

    await expect(makeMigrationCommand()).rejects.toThrow("make:migration requires a name.");
  });

  test("rejects invalid migration names", async () => {
    const { makeMigrationCommand } = await import("@getstrata/cli/scaffold/makeMigration");

    await expect(makeMigrationCommand("!!!")).rejects.toThrow(
      "make:migration requires a valid migration name.",
    );
  });
});

describe("makeFactoryCommand", () => {
  test("creates a factory file for an existing module", async () => {
    await withTempWorkspace(async () => {
      const { makeModuleCommand } = await import("@getstrata/cli/scaffold/makeModule");
      const { makeFactoryCommand } = await import("@getstrata/cli/scaffold/makeFactory");

      await makeModuleCommand("widget");

      const output = captureConsole();
      try {
        await makeFactoryCommand("widget");
      } finally {
        output.restore();
      }

      const factoryPath = join(modulesRoot, "widget", "factory.ts");
      expect(await Bun.file(factoryPath).exists()).toBe(true);
      const factorySource = await Bun.file(factoryPath).text();
      expect(factorySource).toContain('from "@getstrata/core/database/factory"');
      expect(output.logs[0]?.endsWith("src/modules/widget/factory.ts")).toBe(true);
    });
  });

  test("requires a model name", async () => {
    const { makeFactoryCommand } = await import("@getstrata/cli/scaffold/makeFactory");

    await expect(makeFactoryCommand()).rejects.toThrow("make:factory requires a model name.");
  });
});

describe("makeJobCommand", () => {
  test("creates a job file under src/jobs", async () => {
    await withTempWorkspace(async () => {
      const { makeJobCommand } = await import("@getstrata/cli/scaffold/makeJob");
      const output = captureConsole();

      try {
        await makeJobCommand("send invoice");
      } finally {
        output.restore();
      }

      const jobPath = join(process.cwd(), "src/jobs/send-invoiceJob.ts");
      expect(await Bun.file(jobPath).exists()).toBe(true);
      const jobSource = await Bun.file(jobPath).text();
      expect(jobSource).toContain('from "@getstrata/core/queue"');
      expect(output.logs[0]).toBe(`Created job in: ${jobPath}`);
    });
  });

  test("requires a job name", async () => {
    const { makeJobCommand } = await import("@getstrata/cli/scaffold/makeJob");

    await expect(makeJobCommand()).rejects.toThrow("make:job requires a job name.");
  });
});

describe("makePolicyCommand", () => {
  test("creates a policy file for an existing module", async () => {
    await withTempWorkspace(async () => {
      const moduleDirectory = join(modulesRoot, "inventory");
      await ensureDirectory(moduleDirectory);
      await writeFile(
        join(moduleDirectory, "types.ts"),
        "export type InventoryRecord = { id: number };",
      );

      const { makePolicyCommand } = await import("@getstrata/cli/scaffold/makePolicy");
      const output = captureConsole();

      try {
        await makePolicyCommand("inventory");
      } finally {
        output.restore();
      }

      const policyPath = join(moduleDirectory, "policy.ts");
      expect(await Bun.file(policyPath).exists()).toBe(true);
      const policySource = await Bun.file(policyPath).text();
      expect(policySource).toContain('from "@getstrata/core/auth/policy"');
      expect(output.logs[0]?.endsWith("src/modules/inventory/policy.ts")).toBe(true);
      expect(output.logs.some((line) => line.includes("apps/hiroapp"))).toBe(false);
      expect(output.logs.some((line) => line.includes("src/modules/inventory"))).toBe(true);
    });
  });

  test("requires a module name", async () => {
    const { makePolicyCommand } = await import("@getstrata/cli/scaffold/makePolicy");

    await expect(makePolicyCommand()).rejects.toThrow("make:policy requires a module name.");
  });

  test("requires the module directory to exist", async () => {
    await withTempWorkspace(async () => {
      const { makePolicyCommand } = await import("@getstrata/cli/scaffold/makePolicy");

      await expect(makePolicyCommand("missing-module")).rejects.toThrow("Module not found:");
    });
  });
});

describe("makeRequestCommand", () => {
  test("creates request helpers for an existing module", async () => {
    await withTempWorkspace(async () => {
      const moduleDirectory = join(modulesRoot, "catalog");
      await ensureDirectory(moduleDirectory);
      await writeFile(
        join(moduleDirectory, "types.ts"),
        "export type CatalogRecord = { id: number };",
      );

      const { makeRequestCommand } = await import("@getstrata/cli/scaffold/makeRequest");
      const output = captureConsole();

      try {
        await makeRequestCommand("catalog");
      } finally {
        output.restore();
      }

      const requestPath = join(moduleDirectory, "requests.ts");
      expect(await Bun.file(requestPath).exists()).toBe(true);
      expect(output.logs[0]?.endsWith("src/modules/catalog/requests.ts")).toBe(true);
    });
  });

  test("requires a module name", async () => {
    const { makeRequestCommand } = await import("@getstrata/cli/scaffold/makeRequest");

    await expect(makeRequestCommand()).rejects.toThrow("make:request requires a module name.");
  });
});

describe("makeListenerCommand", () => {
  test("creates a listener file under src/listeners", async () => {
    await withTempWorkspace(async () => {
      const { makeListenerCommand } = await import("@getstrata/cli/scaffold/makeListener");
      const output = captureConsole();

      try {
        await makeListenerCommand("invoice paid", "invoice.paid");
      } finally {
        output.restore();
      }

      const listenerPath = join(process.cwd(), "src/listeners/invoice-paid.ts");
      expect(await Bun.file(listenerPath).exists()).toBe(true);
      expect(output.logs.some((line) => line.includes("Listening for event: invoice.paid"))).toBe(
        true,
      );
    });
  });

  test("requires a listener name", async () => {
    const { makeListenerCommand } = await import("@getstrata/cli/scaffold/makeListener");

    await expect(makeListenerCommand()).rejects.toThrow("make:listener requires a listener name.");
  });
});
