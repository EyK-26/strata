import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { toCamelCase, toKebabCase, toPascalCase } from "./utils";

async function makeListenerCommand(name?: string, eventName?: string): Promise<void> {
  if (!name) {
    throw new Error("make:listener requires a listener name.");
  }

  const listenerSlug = toKebabCase(name);
  const registerFunction = `register${toPascalCase(name)}Listener`;
  const directory = join(process.cwd(), "src", "listeners");
  const listenerPath = join(directory, `${listenerSlug}.ts`);
  const resolvedEventName = eventName ?? `${toCamelCase(name)}.created`;

  await mkdir(directory, { recursive: true });

  try {
    await access(listenerPath);
    throw new Error(`Listener already exists: ${listenerPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Listener already exists:")) {
      throw error;
    }
  }

  const content = `import { eventBus } from "../core/events";

function ${registerFunction}(): void {
  eventBus.listen("${resolvedEventName}", async (payload) => {
    void payload;
  });
}

export default ${registerFunction};
`;

  await Bun.write(listenerPath, content);

  console.log(`Created listener in: ${listenerPath}`);
  console.log(`Listening for event: ${resolvedEventName}`);
  console.log("It will be auto-discovered from src/listeners/ on the next app boot.");
}

export { makeListenerCommand };
