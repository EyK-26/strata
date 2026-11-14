import { access } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import { moduleDirectory, toKebabCase, toPascalCase } from "./utils";

async function makePolicyCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:policy", args);
  if (!parsed) return;
  const [moduleName] = parsed;
  if (!moduleName) {
    throw new Error("make:policy requires a module name.");
  }

  const moduleSlug = toKebabCase(moduleName);
  const resourceName = toPascalCase(moduleName);
  const directory = await moduleDirectory(moduleSlug);
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

  const content = `import { Policy } from "@getstrata/core/auth/policy";
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

  await writeScaffoldFile(relative(process.cwd(), policyPath).split(sep), content, "Policy");

  console.log(`Created policy in: ${policyPath}`);
  console.log(
    `Register it in your module index: policies: { "${moduleSlug}": new ${policyClass}() }.`,
  );
}

export { makePolicyCommand };
