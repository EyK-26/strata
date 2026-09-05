import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureConsole } from "./helpers";

const tempDirectories: string[] = [];
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);

  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function withTempProject(run: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "strata-cli-generate-"));
  tempDirectories.push(workspace);
  await mkdir(join(workspace, "docs"), { recursive: true });
  process.chdir(workspace);

  await run(workspace);
}

describe("newCommand", () => {
  test("writes FRONTEND_MODE to the selected env file", async () => {
    await withTempProject(async (workspace) => {
      const { newCommand } = await import("../../../src/cli/commands/new");
      const output = captureConsole();

      try {
        await newCommand("--frontend=server-htmx", "--env=.env.test");
      } finally {
        output.restore();
      }

      const envContents = await readFile(join(workspace, ".env.test"), "utf8");
      expect(envContents).toContain("FRONTEND_MODE=server-htmx");
      expect(output.logs.some((line) => line.includes('Frontend mode set to "server-htmx"'))).toBe(
        true,
      );
      expect(output.logs.some((line) => line.includes("Server pages enabled:"))).toBe(true);
    });
  });

  test("defaults to api-only mode", async () => {
    await withTempProject(async (workspace) => {
      const { newCommand } = await import("../../../src/cli/commands/new");
      const output = captureConsole();

      try {
        await newCommand("--env=.env.test");
      } finally {
        output.restore();
      }

      const envContents = await readFile(join(workspace, ".env.test"), "utf8");
      expect(envContents).toContain("FRONTEND_MODE=api");
      expect(output.logs.some((line) => line.includes("API-only mode enabled."))).toBe(true);
    });
  });

  test("updates an existing env value in place", async () => {
    await withTempProject(async (workspace) => {
      await writeFile(join(workspace, ".env.test"), "FRONTEND_MODE=api\nOTHER=value\n", "utf8");
      const { newCommand } = await import("../../../src/cli/commands/new");

      await newCommand("--frontend=spa-react", "--env=.env.test");

      const envContents = await readFile(join(workspace, ".env.test"), "utf8");
      expect(envContents).toContain("FRONTEND_MODE=spa-react");
      expect(envContents).toContain("OTHER=value");
    });
  });

  test("logs spa-react setup instructions", async () => {
    await withTempProject(async () => {
      const { newCommand } = await import("../../../src/cli/commands/new");
      const output = captureConsole();

      try {
        await newCommand("--frontend=spa-react", "--env=.env.test");
      } finally {
        output.restore();
      }

      expect(output.logs.some((line) => line.includes('Frontend mode set to "spa-react"'))).toBe(
        true,
      );
      expect(output.logs.some((line) => line.includes("SPA mode enabled:"))).toBe(true);
      expect(output.logs.some((line) => line.includes("Bun + React"))).toBe(true);
      expect(existsSync(join(process.cwd(), "frontend/build.ts"))).toBe(true);
      expect(existsSync(join(process.cwd(), "frontend/dev-server.ts"))).toBe(true);
      expect(existsSync(join(process.cwd(), "frontend/vite.config.ts"))).toBe(false);
    });
  });

  test("parseFrontendMode accepts supported values", async () => {
    const { parseFrontendMode } = await import("../../../src/cli/commands/new");

    expect(parseFrontendMode("server-htmx")).toBe("server-htmx");
    expect(parseFrontendMode("spa-react")).toBe("spa-react");
    expect(parseFrontendMode("hybrid")).toBe("hybrid");
    expect(parseFrontendMode("unknown")).toBe("api");
  });

  test("parseTemplateMode mirrors frontend modes", async () => {
    const { parseTemplateMode } = await import("../../../src/cli/commands/new");

    expect(parseTemplateMode("server-htmx")).toBe("server-htmx");
    expect(parseTemplateMode("api")).toBe("api");
  });

  test("accepts --template alias", async () => {
    await withTempProject(async (workspace) => {
      const { newCommand } = await import("../../../src/cli/commands/new");

      await newCommand("--template=server-htmx", "--env=.env.test");

      const envContents = await readFile(join(workspace, ".env.test"), "utf8");
      expect(envContents).toContain("FRONTEND_MODE=server-htmx");
      expect(await Bun.file(join(workspace, "resources/views/layouts/app.eta")).exists()).toBe(
        true,
      );
    });
  });

  test("copies api scaffold readme", async () => {
    await withTempProject(async (workspace) => {
      const { newCommand } = await import("../../../src/cli/commands/new");

      await newCommand("--template=api", "--env=.env.test");

      expect(await Bun.file(join(workspace, "docs/API.md")).exists()).toBe(true);
    });
  });

  test("hybrid copies staff HTML and SPA scaffolds without claiming / for the SPA", async () => {
    await withTempProject(async (workspace) => {
      const { newCommand } = await import("../../../src/cli/commands/new");
      const output = captureConsole();

      try {
        await newCommand("--frontend=hybrid", "--env=.env.test");
      } finally {
        output.restore();
      }

      const envContents = await readFile(join(workspace, ".env.test"), "utf8");
      expect(envContents).toContain("FRONTEND_MODE=hybrid");
      expect(await Bun.file(join(workspace, "resources/views/layouts/app.eta")).exists()).toBe(
        true,
      );
      expect(existsSync(join(workspace, "frontend/build.ts"))).toBe(true);
      expect(output.logs.some((line) => line.includes("Hybrid mode enabled:"))).toBe(true);
    });
  });
});

describe("openapiGenerateCommand", () => {
  test("writes the generated OpenAPI document to docs/openapi.json", async () => {
    await withTempProject(async (workspace) => {
      const { openapiGenerateCommand } = await import("../../../src/cli/commands/openapiGenerate");
      const output = captureConsole();

      try {
        await openapiGenerateCommand();
      } finally {
        output.restore();
      }

      const jsonPath = join(workspace, "docs/openapi.json");
      const contents = await readFile(jsonPath, "utf8");

      expect(contents).toContain('"openapi"');
      expect(output.logs[0]).toMatch(
        /^OpenAPI spec written to .*docs\/openapi\.json \(\d+ routes\)\.$/,
      );
    });
  });
});

describe("sdkGenerateCommand", () => {
  test("writes the generated TypeScript SDK client", async () => {
    await withTempProject(async (workspace) => {
      const { sdkGenerateCommand } = await import("../../../src/cli/commands/sdkGenerate");
      const output = captureConsole();

      try {
        await sdkGenerateCommand();
      } finally {
        output.restore();
      }

      const clientPath = join(workspace, "sdk/typescript/client.ts");
      const contents = await readFile(clientPath, "utf8");

      expect(contents).toContain("export");
      expect(output.logs[0]).toBe(`TypeScript SDK written to ${clientPath}.`);
    });
  });
});
