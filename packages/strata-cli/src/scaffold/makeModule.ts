import { access } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { renderModuleScaffold } from "./renderModule";
import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import {
  moduleDirectory,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  webViewsDirectory,
} from "./utils";

async function makeModuleCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:module", args, ["--with-web"]);
  if (!parsed) return;
  const withWeb = args.includes("--with-web");
  const [name] = parsed;

  if (!name) {
    throw new Error("make:module requires a name.");
  }

  const moduleSlug = toKebabCase(name);
  const moduleName = toPascalCase(name);
  const moduleIdentifier = toCamelCase(name);

  if (!moduleName || !moduleIdentifier || !moduleSlug) {
    throw new Error("make:module requires a valid module name.");
  }

  const directory = await moduleDirectory(moduleSlug);

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

  const { files, webFiles, viewFiles, pluralSlug } = renderModuleScaffold({
    moduleSlug,
    moduleName,
    moduleIdentifier,
    withWeb,
  });

  for (const [fileName, content] of files) {
    await writeScaffoldFile(
      relative(process.cwd(), join(directory, fileName)).split(sep),
      content,
      "Module file",
    );
  }

  let createdViewsDirectory: string | undefined;

  if (withWeb) {
    const viewsDirectory = webViewsDirectory(pluralSlug);
    createdViewsDirectory = viewsDirectory;
    for (const [fileName, content] of viewFiles) {
      await writeScaffoldFile(
        relative(process.cwd(), join(viewsDirectory, fileName)).split(sep),
        content,
        "Module view",
      );
    }
    for (const [fileName, content] of webFiles) {
      await writeScaffoldFile(
        relative(process.cwd(), join(directory, fileName)).split(sep),
        content,
        "Module file",
      );
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

  console.log("Register the generated repository definition in application database bindings.");
}

export { makeModuleCommand };
