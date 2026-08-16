import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createAppContext } from "../../../src/bootstrap/context";
import { createRoutes } from "../../../src/bootstrap/createRoutes";
import { openapiCheckCommand } from "../../../src/cli/commands/openapiCheck";
import { openapiValidateCommand } from "../../../src/cli/commands/openapiValidate";
import { generateOpenApiSpec, renderOpenApiDocument } from "../../../src/core/openapi/generator";
import { captureConsole, mockProcessExit } from "./helpers";

const tempDirectories: string[] = [];
const originalCwd = process.cwd();

beforeAll(async () => {
  await ensureModulesLoaded();
});

afterEach(async () => {
  process.chdir(originalCwd);

  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function withOpenApiWorkspace(
  openapiContents: string,
  run: () => Promise<void>,
): Promise<void> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "workhub-openapi-check-"));
  tempDirectories.push(tempDirectory);

  const docsDirectory = join(tempDirectory, "docs");
  await mkdir(docsDirectory, { recursive: true });
  await writeFile(join(docsDirectory, "openapi.json"), openapiContents, "utf8");

  process.chdir(tempDirectory);
  await run();
}

describe("openapiValidateCommand", () => {
  test("validates the generated OpenAPI spec", async () => {
    const output = captureConsole();

    try {
      await openapiValidateCommand();
    } finally {
      output.restore();
    }

    expect(output.errors).toHaveLength(0);
    expect(output.logs).toHaveLength(1);
    expect(output.logs[0]).toMatch(/^OpenAPI spec valid \(\d+ routes\)\.$/);
  });
});

describe("openapiCheckCommand", () => {
  test("passes when committed OpenAPI file matches generated spec", async () => {
    const { dependencies } = createAppContext();
    createRoutes(dependencies);
    const generated = renderOpenApiDocument(generateOpenApiSpec(routeRegistry.list()));

    const output = captureConsole();

    await withOpenApiWorkspace(generated, async () => {
      await openapiCheckCommand();
    });

    output.restore();

    expect(output.errors).toHaveLength(0);
    expect(output.logs).toHaveLength(1);
    expect(output.logs[0]).toMatch(/^OpenAPI spec matches committed file \(\d+ routes\)\.$/);
  });

  test("fails when committed OpenAPI file drifts from generated spec", async () => {
    const output = captureConsole();
    const exit = mockProcessExit();

    try {
      await withOpenApiWorkspace('{"openapi":"3.1.0"}', async () => {
        await expect(openapiCheckCommand()).rejects.toThrow("process.exit");
      });
    } finally {
      output.restore();
      exit.restore();
    }

    expect(exit.getCode()).toBe(1);
    expect(output.errors.some((line) => line.includes("OpenAPI spec drift detected."))).toBe(true);
  });
});

describe("openapi CLI validation failures", () => {
  let invalidOpenapiValidateCommand: typeof openapiValidateCommand;
  let invalidOpenapiCheckCommand: typeof openapiCheckCommand;

  beforeAll(async () => {
    mock.module("../../../src/core/openapi/validate", () => ({
      validateOpenApiSpec: () => ["Missing bearerAuth security scheme."],
    }));

    [
      { openapiValidateCommand: invalidOpenapiValidateCommand },
      { openapiCheckCommand: invalidOpenapiCheckCommand },
    ] = await Promise.all([
      import("../../../src/cli/commands/openapiValidate"),
      import("../../../src/cli/commands/openapiCheck"),
    ]);
  });

  afterAll(() => {
    mock.restore();
  });

  test("openapiValidateCommand fails when generated OpenAPI spec is invalid", async () => {
    const output = captureConsole();
    const exit = mockProcessExit();

    try {
      await expect(invalidOpenapiValidateCommand()).rejects.toThrow("process.exit");
    } finally {
      output.restore();
      exit.restore();
    }

    expect(exit.getCode()).toBe(1);
    expect(output.errors.some((line) => line.includes("OpenAPI validation failed:"))).toBe(true);
    expect(output.errors.some((line) => line.includes("Missing bearerAuth security scheme."))).toBe(
      true,
    );
  });

  test("openapiCheckCommand fails when generated OpenAPI spec is invalid", async () => {
    const { dependencies } = createAppContext();
    createRoutes(dependencies);
    const generated = renderOpenApiDocument(generateOpenApiSpec(routeRegistry.list()));

    const output = captureConsole();
    const exit = mockProcessExit();

    try {
      await withOpenApiWorkspace(generated, async () => {
        await expect(invalidOpenapiCheckCommand()).rejects.toThrow("process.exit");
      });
    } finally {
      output.restore();
      exit.restore();
    }

    expect(exit.getCode()).toBe(1);
    expect(output.errors.some((line) => line.includes("OpenAPI validation failed:"))).toBe(true);
    expect(output.errors.some((line) => line.includes("Missing bearerAuth security scheme."))).toBe(
      true,
    );
  });
});
