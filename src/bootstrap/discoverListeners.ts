import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type ListenerRegistrar = () => void;

async function loadDiscoveredListeners(): Promise<ListenerRegistrar[]> {
  const listenersDirectory = join(import.meta.dir, "../listeners");

  let entries: string[];

  try {
    entries = readdirSync(listenersDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
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
