import type { Stats } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Validate before normalization so traversal and punctuation cannot become a different name. */
function scaffoldNameParts(
  value: string | undefined,
  command: string,
  options: { filename?: boolean } = {},
): string[] {
  if (!value) throw new Error(`${command} requires a name.`);
  const parts = value.split("/");
  const pattern = options.filename ? /^_?[A-Za-z0-9][A-Za-z0-9 _-]*$/ : /^[A-Za-z][A-Za-z0-9 _-]*$/;
  if (parts.some((part) => !pattern.test(part) || part !== part.trim()))
    throw new Error(
      `${command} requires a valid relative name; use letters, digits, spaces, _ or - within slash-separated names.`,
    );
  return parts;
}

/** Exclusive creation; never overwrite existing files or follow existing output symlinks. */
async function writeScaffoldFile(
  segments: string[],
  content: string,
  label: string,
): Promise<string> {
  let directory = process.cwd();
  for (const segment of segments.slice(0, -1)) {
    directory = join(directory, segment);
    let entry: Stats;
    try {
      entry = await lstat(directory);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      await mkdir(directory, { recursive: true });
      entry = await lstat(directory);
    }
    if (entry.isSymbolicLink())
      throw new Error(`Refusing symbolic link in scaffold output: ${directory}`);
    if (!entry.isDirectory()) throw new Error(`Scaffold parent is not a directory: ${directory}`);
  }
  const path = join(directory, segments.at(-1) ?? "");
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(`${label} already exists: ${path}; overwrite refused.`, { cause: error });
    throw error;
  }
  return path;
}

export { scaffoldNameParts, writeScaffoldFile };
