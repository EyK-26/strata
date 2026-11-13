import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateOpenApiSpec,
  renderTypeScriptSdk,
  resolveOpenApiConfig,
} from "../../core/openapi/generator";
import { registerOpenApiRoutes } from "./registerOpenApiRoutes";

async function sdkGenerateCommand(): Promise<void> {
  const config = resolveOpenApiConfig(process.env);
  const routes = await registerOpenApiRoutes();
  const spec = generateOpenApiSpec(routes, config);
  const outputDirectory = join(process.cwd(), "sdk/typescript");
  const outputPath = join(outputDirectory, "client.ts");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    outputPath,
    renderTypeScriptSdk(spec, config.apiPrefix, config.sdkClassName),
    "utf8",
  );

  console.log(`TypeScript SDK written to ${outputPath}.`);
}

export { sdkGenerateCommand };
