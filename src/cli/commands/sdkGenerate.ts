import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAppContext } from "../../bootstrap/context";
import { createRoutes } from "../../bootstrap/createRoutes";
import { routeRegistry } from "../../bootstrap/routeRegistry";
import {
  generateOpenApiSpec,
  renderTypeScriptSdk,
} from "../../core/openapi/generator";

async function sdkGenerateCommand(): Promise<void> {
  const { dependencies } = createAppContext();
  createRoutes(dependencies);

  const spec = generateOpenApiSpec(routeRegistry.list());
  const outputDirectory = join(process.cwd(), "sdk/typescript");
  const outputPath = join(outputDirectory, "client.ts");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, renderTypeScriptSdk(spec), "utf8");

  console.log(`TypeScript SDK written to ${outputPath}.`);
}

export { sdkGenerateCommand };
