import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirectory } from "../../../src/cli/commands/utils";
import { captureConsole, repoRoot } from "./helpers";

const tempDirectories: string[] = [];

async function withTempWorkspace(run: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "strata-cli-scaffold-")));
  tempDirectories.push(workspace);
  const previousCwd = process.cwd();
  process.chdir(workspace);

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
    await withTempWorkspace(async (workspace) => {
      const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");
      const output = captureConsole();

      try {
        await makeModuleCommand("billing widget");
      } finally {
        output.restore();
      }

      const moduleDirectory = join(workspace, "src", "modules", "billing-widget");
      expect(await Bun.file(join(moduleDirectory, "index.ts")).exists()).toBe(true);
      expect(await Bun.file(join(moduleDirectory, "controller.ts")).exists()).toBe(true);
      expect(await Bun.file(join(moduleDirectory, "policy.ts")).exists()).toBe(true);
      expect(output.logs.some((line) => line.includes("Created module scaffold in:"))).toBe(true);
      expect(output.logs.some((line) => line.includes(moduleDirectory))).toBe(true);
    });
  });

  test("creates web scaffolds when --with-web is passed", async () => {
    await withTempWorkspace(async (workspace) => {
      const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");
      const output = captureConsole();

      try {
        await makeModuleCommand("--with-web", "release note");
      } finally {
        output.restore();
      }

      const moduleDirectory = join(workspace, "src", "modules", "release-note");
      expect(await Bun.file(join(moduleDirectory, "webRoutes.ts")).exists()).toBe(true);
      expect(
        await Bun.file(join(workspace, "resources/views/release-notes/index.eta")).exists(),
      ).toBe(true);
      expect(output.logs.some((line) => line.includes("Created web view scaffold"))).toBe(true);
    });
  });

  test("writes --with-web views under views/ when that directory exists", async () => {
    await withTempWorkspace(async (workspace) => {
      await ensureDirectory(join(workspace, "views"));
      const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");
      const output = captureConsole();

      try {
        await makeModuleCommand("--with-web", "catalog item");
      } finally {
        output.restore();
      }

      expect(await Bun.file(join(workspace, "views/catalog-items/index.eta")).exists()).toBe(true);
    });
  });

  test("preserves application-owned definition arrays and emits explicit registration guidance", async () => {
    await withTempWorkspace(async (workspace) => {
      const registerPath = join(workspace, "src", "models", "register.ts");
      await ensureDirectory(join(workspace, "src", "models"));
      await writeFile(
        registerPath,
        `import { Note, NoteRepository } from "./Note.ts";
export const modelDefinitions = [Note];
export const repositoryDefinitions = [NoteRepository];
`,
      );
      const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");
      const output = captureConsole();

      try {
        await makeModuleCommand("invoice");
      } finally {
        output.restore();
      }

      const register = await Bun.file(registerPath).text();
      expect(register).toBe(`import { Note, NoteRepository } from "./Note.ts";
export const modelDefinitions = [Note];
export const repositoryDefinitions = [NoteRepository];
`);
      const repository = await Bun.file(join(workspace, "src/modules/invoice/model.ts")).text();
      expect(repository).toContain("createModel({");
      expect(repository).toContain("invoiceRepository");
      expect(repository).not.toContain("registerModelClass");
      expect(output.logs).toContain(
        "Register the generated repository definition in application database bindings.",
      );
    });
  });

  test("requires a module name", async () => {
    const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");

    await expect(makeModuleCommand()).rejects.toThrow("make:module requires a name.");
  });

  test("rejects duplicate modules", async () => {
    await withTempWorkspace(async () => {
      const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");

      await makeModuleCommand("duplicate-module");
      await expect(makeModuleCommand("duplicate-module")).rejects.toThrow("Module already exists:");
    });
  });

  test("rejects invalid module names", async () => {
    const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");

    await expect(makeModuleCommand("!!!")).rejects.toThrow(
      "make:module requires a valid relative name",
    );
  });
});

describe("makeMigrationCommand", () => {
  test("creates a migration file in the temp migrations directory", async () => {
    await withTempWorkspace(async (workspace) => {
      const { makeMigrationCommand } = await import("../../../src/cli/commands/makeMigration");
      const output = captureConsole();

      try {
        await makeMigrationCommand("add widgets table");
      } finally {
        output.restore();
      }

      const migrationsRoot = join(workspace, "src", "db", "migrations");
      const files = await Array.fromAsync(new Bun.Glob("*.ts").scan(migrationsRoot));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/_add_widgets_table\.ts$/);
      const source = await Bun.file(join(migrationsRoot, files[0] ?? "")).text();
      expect(source).toContain('from "@getstrata/core/database/migrations"');
      expect(source).toContain("defineMigration({");
      expect(source).toContain("up(schema, db)");
      expect(source).not.toContain("SELECT 1");
      expect(output.logs[0]).toMatch(/^Created migration: /);
    });
  });

  test("requires a migration name", async () => {
    const { makeMigrationCommand } = await import("../../../src/cli/commands/makeMigration");

    await expect(makeMigrationCommand()).rejects.toThrow("make:migration requires a name.");
  });

  test("rejects invalid migration names", async () => {
    const { makeMigrationCommand } = await import("../../../src/cli/commands/makeMigration");

    await expect(makeMigrationCommand("!!!")).rejects.toThrow(
      "make:migration requires a valid relative name",
    );
  });
});

describe("makeFactoryCommand", () => {
  test("creates a factory file for an existing module", async () => {
    await withTempWorkspace(async (workspace) => {
      const { makeModuleCommand } = await import("../../../src/cli/commands/makeModule");
      const { makeFactoryCommand } = await import("../../../src/cli/commands/makeFactory");

      await makeModuleCommand("widget");

      const output = captureConsole();
      try {
        await makeFactoryCommand("widget");
      } finally {
        output.restore();
      }

      const factoryPath = join(workspace, "src", "modules", "widget", "factory.ts");
      expect(await Bun.file(factoryPath).exists()).toBe(true);
      const factorySource = await Bun.file(factoryPath).text();
      expect(factorySource).toContain('from "@getstrata/core/database/factory"');
      expect(factorySource).toContain("definition: () => WidgetRecord");
      expect(factorySource).toContain("persist?: FactoryPersist<WidgetRecord>");
      expect(factorySource).toContain(
        "function createWidgetFactory(definition: () => WidgetRecord, persist?: FactoryPersist<WidgetRecord>)",
      );
      expect(factorySource).toContain("createFactory({ definition, persist })");
      expect(factorySource).not.toContain("extends Factory");
      expect(factorySource).not.toContain("as WidgetRecord");
      await expect(makeFactoryCommand("widget")).rejects.toThrow(
        `Factory already exists: ${factoryPath}`,
      );
      expect(await Bun.file(factoryPath).text()).toBe(factorySource);
      expect(output.logs[0]).toBe(`Created factory: ${factoryPath}`);
    });
  });

  test("requires a model name", async () => {
    const { makeFactoryCommand } = await import("../../../src/cli/commands/makeFactory");

    await expect(makeFactoryCommand()).rejects.toThrow("make:factory requires a model name.");
  });
});

describe("makeJobCommand", () => {
  test("creates a job file under src/jobs", async () => {
    await withTempWorkspace(async (workspace) => {
      const { makeJobCommand } = await import("../../../src/cli/commands/makeJob");
      const output = captureConsole();

      try {
        await makeJobCommand("send invoice");
      } finally {
        output.restore();
      }

      const jobPath = join(workspace, "src/jobs/send-invoiceJob.ts");
      expect(await Bun.file(jobPath).exists()).toBe(true);
      const jobSource = await Bun.file(jobPath).text();
      expect(jobSource).toContain('from "@getstrata/core/queue"');
      expect(jobSource).toContain('static readonly jobName = "send-invoice"');
      expect(output.logs[0]).toBe(`Created job in: ${jobPath}`);
    });
  });

  test("requires a job name", async () => {
    const { makeJobCommand } = await import("../../../src/cli/commands/makeJob");

    await expect(makeJobCommand()).rejects.toThrow("make:job requires a job name.");
  });
});

describe("makePolicyCommand", () => {
  test("creates a policy file for an existing module", async () => {
    await withTempWorkspace(async (workspace) => {
      const moduleDirectory = join(workspace, "src", "modules", "inventory");
      await ensureDirectory(moduleDirectory);
      await writeFile(
        join(moduleDirectory, "types.ts"),
        "export type InventoryRecord = { id: number };",
      );

      const { makePolicyCommand } = await import("../../../src/cli/commands/makePolicy");
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
      expect(output.logs[0]).toBe(`Created policy in: ${policyPath}`);
      expect(output.logs.some((line) => line.includes("apps/hiroapp"))).toBe(false);
      expect(output.logs.some((line) => line.includes("src/modules/inventory"))).toBe(true);
    });
  });

  test("requires a module name", async () => {
    const { makePolicyCommand } = await import("../../../src/cli/commands/makePolicy");

    await expect(makePolicyCommand()).rejects.toThrow("make:policy requires a module name.");
  });

  test("requires the module directory to exist", async () => {
    await withTempWorkspace(async () => {
      const { makePolicyCommand } = await import("../../../src/cli/commands/makePolicy");

      await expect(makePolicyCommand("missing-module")).rejects.toThrow("Module not found:");
    });
  });
});

describe("makeRequestCommand", () => {
  test("creates request helpers for an existing module", async () => {
    await withTempWorkspace(async (workspace) => {
      const moduleDirectory = join(workspace, "src", "modules", "catalog");
      await ensureDirectory(moduleDirectory);
      await writeFile(
        join(moduleDirectory, "types.ts"),
        "export type CatalogRecord = { id: number };",
      );

      const { makeRequestCommand } = await import("../../../src/cli/commands/makeRequest");
      const output = captureConsole();

      try {
        await makeRequestCommand("catalog");
      } finally {
        output.restore();
      }

      const requestPath = join(moduleDirectory, "requests.ts");
      expect(await Bun.file(requestPath).exists()).toBe(true);
      const requestSource = await Bun.file(requestPath).text();
      expect(requestSource).toContain('from "@getstrata/core/http"');
      expect(requestSource).not.toContain("../../core/http");
      expect(output.logs[0]).toBe(`Created request helpers: ${requestPath}`);
    });
  });

  test("requires a module name", async () => {
    const { makeRequestCommand } = await import("../../../src/cli/commands/makeRequest");

    await expect(makeRequestCommand()).rejects.toThrow("make:request requires a module name.");
  });
});

describe("makeListenerCommand", () => {
  test("creates a listener file under src/listeners", async () => {
    await withTempWorkspace(async (workspace) => {
      const { makeListenerCommand } = await import("../../../src/cli/commands/makeListener");
      const output = captureConsole();

      try {
        await makeListenerCommand("invoice paid", "invoice.paid");
      } finally {
        output.restore();
      }

      const listenerPath = join(workspace, "src/listeners/invoice-paid.ts");
      expect(await Bun.file(listenerPath).exists()).toBe(true);
      expect(output.logs.some((line) => line.includes("Listening for event: invoice.paid"))).toBe(
        true,
      );
    });
  });

  test("requires a listener name", async () => {
    const { makeListenerCommand } = await import("../../../src/cli/commands/makeListener");

    await expect(makeListenerCommand()).rejects.toThrow("make:listener requires a listener name.");
  });
});

test("make:model emits an executable declaration with an explicit repository and session", async () => {
  await withTempWorkspace(async (workspace) => {
    const { makeModelCommand } = await import(
      "../../../packages/strata-cli/src/scaffold/makeModel"
    );
    await makeModelCommand("Contact", "--key-type=string");
    const path = join(workspace, "src/models/Contact.ts");
    const source = await Bun.file(path).text();
    expect(source).toContain("createModel({");
    expect(source).not.toContain("construct:");
    // Point this temporary consumer at the real source, independent of installed workspace links.
    await writeFile(
      path,
      source
        .replace("@getstrata/core/database/model", join(repoRoot, "src/core/database/model.ts"))
        .replace("@getstrata/core/database/table", join(repoRoot, "src/core/database/table.ts")),
    );
    type GeneratedDefinition = ReturnType<
      typeof import("../../../src/core/database/model").createModel<{ id: string }, "id">
    >;
    const { ContactDefinition, ContactRepository } = (await import(path)) as {
      ContactDefinition: GeneratedDefinition;
      ContactRepository: GeneratedDefinition["repository"];
    };
    expect(ContactDefinition.repository).toBe(ContactRepository);
    expect(ContactDefinition.attributes.fillable).toEqual(["id"]);
    expect(ContactDefinition.attributes.timestamps).toBe(false);
    const { withBoundDatabase } = await import("../../helpers/boundRepositoryHarness");
    await withBoundDatabase(
      {
        definition: {
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
          repositories: [ContactRepository],
          models: [ContactDefinition],
        },
      },
      async (db) => {
        await db.execute({ text: "CREATE TABLE contacts (id TEXT PRIMARY KEY)", params: [] });
        const contact = await db.model(ContactDefinition).create({ id: "generated" });
        expect(contact.id).toBe("generated");
        expect((await db.model(ContactDefinition).findOrFail("generated")).id).toBe("generated");
      },
    );
  });
});
