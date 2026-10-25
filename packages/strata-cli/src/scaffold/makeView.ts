import { lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { scaffoldNameParts, writeScaffoldFile } from "./scaffoldFile";
import { toKebabCase, webViewsDirectory } from "./utils";

async function makeViewCommand(...args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: strata make:view <name|group/name[.eta]>");
    console.log(
      "Uses views when it exists, otherwise resources/views. Existing files are never overwritten.",
    );
    console.log(
      "Creates only an Eta template; no routes, controllers, providers or schema changes.",
    );
    return;
  }
  if (args.some((arg) => arg.startsWith("-")))
    throw new Error("Unsupported make:view option; use --help. Overwrite is not supported.");
  if (args.length > 1) throw new Error("make:view accepts one view name.");
  const raw = args[0]?.endsWith(".eta") ? args[0].slice(0, -4) : args[0];
  const parts = scaffoldNameParts(raw, "make:view", { filename: true }).map((part) =>
    part.startsWith("_") ? `_${toKebabCase(part.slice(1))}` : toKebabCase(part),
  );
  // A dangling link must not silently select a different root through existsSync().
  try {
    if ((await lstat(join(process.cwd(), "views"))).isSymbolicLink())
      throw new Error("Refusing symbolic link in scaffold output: views");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const base = relative(process.cwd(), webViewsDirectory("")).split(sep);
  const title = JSON.stringify(parts.join(" / "));
  const content = `<section>
  <h1><%= it.title ?? ${title} %></h1>
  <p><%= it.message ?? "" %></p>
</section>
`;
  const path = await writeScaffoldFile(
    [...base, ...parts.slice(0, -1), `${parts.at(-1)}.eta`],
    content,
    "View",
  );
  console.log(`Created view: ${path}`);
  console.log(
    `Render as "${parts.join("/")}" using the app's Eta view renderer; no routes were added.`,
  );
}

export { makeViewCommand };
