import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type ListenerRegistrar = () => void;

function resolveListenersDirectory(): string {
  const fromCwd = join(process.cwd(), "src", "listeners");

  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  return join(import.meta.dir, "../listeners");
}

async function loadDiscoveredListeners(): Promise<ListenerRegistrar[]> {
  const listenersDirectory = resolveListenersDirectory();

  let entries: string[];

  try {
    entries = readdirSync(listenersDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|js)$/.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const listeners = await Promise.all(
    entries.map(async (fileName) => {
      const moduleUrl = pathToFileURL(join(listenersDirectory, fileName)).href;
      const loaded = (await import(moduleUrl)) as { default?: ListenerRegistrar };
      return loaded.default;
    }),
  );

  return listeners.filter(
    (listener): listener is ListenerRegistrar => typeof listener === "function",
  );
}

const appListeners = await loadDiscoveredListeners();

function discoverListeners(): ListenerRegistrar[] {
  return appListeners;
}

export type { ListenerRegistrar };
export { appListeners, discoverListeners };
