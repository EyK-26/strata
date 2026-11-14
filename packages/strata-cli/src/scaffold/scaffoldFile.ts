import type { Stats } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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
  const target = resolve(process.cwd(), ...segments);
  const local = relative(process.cwd(), target);
  if (!local || local.startsWith(`..${sep}`) || local === ".." || isAbsolute(local))
    throw new Error("Scaffold output must stay inside the application directory.");
  segments = local.split(sep);
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

function scaffoldArguments(
  command: string,
  args: string[],
  flags: string[] = [],
): string[] | undefined {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      `Usage: strata ${command} <Name>${command === "make:listener" ? " [event]" : ""}${flags.map((flag) => ` [${flag}]`).join("")}`,
    );
    return;
  }
  const names = args.filter((arg) => !flags.includes(arg));
  if (names.some((arg) => arg.startsWith("-")))
    throw new Error(`Unsupported ${command} option; use --help.`);
  if (names.length > (command === "make:listener" ? 2 : 1))
    throw new Error(`${command} received too many arguments; use --help.`);
  const noun =
    (
      {
        "make:factory": "model name",
        "make:job": "job name",
        "make:listener": "listener name",
        "make:policy": "module name",
        "make:request": "module name",
      } as Record<string, string>
    )[command] ?? "name";
  if (!names[0]) throw new Error(`${command} requires a ${noun}.`);
  scaffoldNameParts(names[0], command);
  return names;
}

export { scaffoldArguments };
