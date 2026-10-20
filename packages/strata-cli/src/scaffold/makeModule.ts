import { access } from "node:fs/promises";
import { join } from "node:path";
import { renderModuleScaffold } from "./renderModule";
import {
  ensureDirectory,
  moduleDirectory,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  webViewsDirectory,
} from "./utils";

async function makeModuleCommand(...args: string[]): Promise<void> {
  const withWeb = args.includes("--with-web");
  const name = args.find((arg) => !arg.startsWith("--"));

  if (!name) {
    throw new Error("make:module requires a name.");
  }

  const moduleSlug = toKebabCase(name);
  const moduleName = toPascalCase(name);
  const moduleIdentifier = toCamelCase(name);

  if (!moduleName || !moduleIdentifier || !moduleSlug) {
    throw new Error("make:module requires a valid module name.");
  }

  const directory = moduleDirectory(moduleSlug);

  try {
    await access(directory);
    throw new Error(`Module already exists: ${directory}`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      if (error instanceof Error && error.message.startsWith("Module already exists:")) {
        throw error;
      }
      throw error;
    }
  }

  await ensureDirectory(directory);

  const { files, webFiles, viewFiles, pluralSlug } = renderModuleScaffold({
    moduleSlug,
    moduleName,
    moduleIdentifier,
    withWeb,
  });

  for (const [fileName, content] of files) {
    await Bun.write(join(directory, fileName), content);
  }

  let createdViewsDirectory: string | undefined;

  if (withWeb) {
    const viewsDirectory = webViewsDirectory(pluralSlug);
    createdViewsDirectory = viewsDirectory;
    await ensureDirectory(viewsDirectory);
    for (const [fileName, content] of viewFiles) {
      await Bun.write(join(viewsDirectory, fileName), content);
    }
    for (const [fileName, content] of webFiles) {
      await Bun.write(join(directory, fileName), content);
    }
  }

  console.log(`Created module scaffold in: ${directory}`);
  if (createdViewsDirectory) {
    const relativeViews = createdViewsDirectory.startsWith(process.cwd())
      ? createdViewsDirectory.slice(process.cwd().length + 1)
      : createdViewsDirectory;
    console.log(`Created web view scaffold in: ${relativeViews}/`);
    console.log(`API routes use API_PREFIX (default /api/v1); HTML collection: /${pluralSlug}`);
  }
  console.log(`Module will be auto-discovered from the app modules directory (${moduleSlug}/)`);
  console.log(`Next: strata make:migration create_${moduleSlug} && strata migrate`);

  const registerPath = join(process.cwd(), "src", "models", "register.ts");
  try {
    await access(registerPath);
    const existing = await Bun.file(registerPath).text();
    if (!existing.includes(`registerModelClass("${moduleName}"`)) {
      const snippet = `
// ${moduleName}: after you add a Model class, register string aliases here:
// import { ${moduleName} } from "../modules/${moduleSlug}/model.ts";
// registerModelClass("${moduleName}", ${moduleName});
`;
      await Bun.write(registerPath, `${existing.trimEnd()}\n${snippet}`);
      console.log(`Appended a registerModelClass hint to src/models/register.ts`);
    }
  } catch {
    // Generated apps ship register.ts. Older apps can add it from DATABASE.md.
  }
}

export { makeModuleCommand };
