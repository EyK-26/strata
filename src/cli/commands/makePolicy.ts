import { access } from "node:fs/promises";
import { join } from "node:path";
import { moduleDirectory, toCamelCase, toKebabCase, toPascalCase } from "./utils";

async function makePolicyCommand(moduleName?: string): Promise<void> {
  if (!moduleName) {
    throw new Error("make:policy requires a module name.");
  }

  const moduleSlug = toKebabCase(moduleName);
  const resourceName = toPascalCase(moduleName);
  const directory = moduleDirectory(moduleSlug);
  const policyPath = join(directory, "policy.ts");

  try {
    await access(directory);
  } catch {
    throw new Error(`Module not found: ${directory}`);
  }

  try {
    await access(policyPath);
    throw new Error(`Policy already exists: ${policyPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Policy already exists:")) {
      throw error;
    }
  }

  const recordType = `${resourceName}Record`;
  const policyClass = `${resourceName}Policy`;
  const policyVariable = `${toCamelCase(moduleName)}Policy`;

  const content = `import { Policy } from "../../core/auth/policy";
import type { ${recordType} } from "./types";

class ${policyClass} extends Policy {
  override view(_user: unknown, _resource: ${recordType}): boolean {
    return true;
  }

  override create(_user: unknown): boolean {
    return true;
  }

  override update(_user: unknown, _resource: ${recordType}): boolean {
    return true;
  }

  override delete(_user: unknown, _resource: ${recordType}): boolean {
    return true;
  }
}

export default ${policyClass};
`;

  await Bun.write(policyPath, content);

  console.log(`Created policy in: ${policyPath}`);
  console.log(
    `Register it in apps/hiroapp/src/modules/${moduleSlug}/provider.ts boot() via gate.register("${moduleSlug}", container.resolve(${policyVariable})).`,
  );
}

export { makePolicyCommand };
