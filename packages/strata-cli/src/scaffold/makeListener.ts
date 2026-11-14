import { access } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import { toCamelCase, toKebabCase, toPascalCase } from "./utils";

async function makeListenerCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:listener", args);
  if (!parsed) return;
  const [name, eventName] = parsed;
  if (!name) {
    throw new Error("make:listener requires a listener name.");
  }

  const listenerSlug = toKebabCase(name);
  const directory = join(process.cwd(), "src", "listeners");
  const listenerPath = join(directory, `${listenerSlug}.ts`);
  const resolvedEventName = eventName ?? `${toCamelCase(name)}.created`;

  try {
    await access(listenerPath);
    throw new Error(`Listener already exists: ${listenerPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Listener already exists:")) {
      throw error;
    }
  }

  const [table, action, ...extra] = resolvedEventName.split(".");
  const modelEvent =
    extra.length === 0 &&
    ["created", "updated", "deleted", "restored", "force-deleted"].includes(action ?? "");
  const modelName = toPascalCase((table ?? name).replace(/s$/, ""));
  const content = modelEvent
    ? `import { defineModelListener } from "@getstrata/bootstrap/discoverListeners";
import { ${modelName}Repository } from "../models/${modelName}.ts";

export default defineModelListener(${modelName}Repository, ${JSON.stringify(action)}, async row => {
  void row;
});
`
    : `import { defineEventListener } from "@getstrata/bootstrap/discoverListeners";

export default defineEventListener(${JSON.stringify(resolvedEventName)}, async payload => {
  void payload;
});
`;

  await writeScaffoldFile(relative(process.cwd(), listenerPath).split(sep), content, "Listener");

  console.log(`Created listener in: ${listenerPath}`);
  console.log(`Listening for event: ${resolvedEventName}`);
  console.log("It will be auto-discovered from src/listeners/ on the next app boot.");
}

export { makeListenerCommand };
