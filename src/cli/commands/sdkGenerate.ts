import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateOpenApiSpec, renderTypeScriptSdk } from "../../core/openapi/generator";
import { apiPrefix } from "../../core/runtime/appKeyPrefix";
import { registerOpenApiRoutes } from "./registerOpenApiRoutes";

async function sdkGenerateCommand(): Promise<void> {
  const routes = await registerOpenApiRoutes();
  const spec = generateOpenApiSpec(routes);
  const outputDirectory = join(process.cwd(), "sdk/typescript");
  const outputPath = join(outputDirectory, "client.ts");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, renderTypeScriptSdk(spec, apiPrefix()), "utf8");

  console.log(`TypeScript SDK written to ${outputPath}.`);
}

export { sdkGenerateCommand };
