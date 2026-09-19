import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

type ListenerRegistrar = () => void;

const requireListener = createRequire(import.meta.url);

const DISCOVER_LISTENERS_STATE_KEY = Symbol.for("@getstrata/discoverListenersState");

interface DiscoverListenersState {
  appListeners?: ListenerRegistrar[];
}

function readDiscoverListenersState(): DiscoverListenersState {
  const existing = (globalThis as Record<symbol, DiscoverListenersState | undefined>)[
    DISCOVER_LISTENERS_STATE_KEY
  ];

  if (existing) {
    return existing;
  }

  const state: DiscoverListenersState = {};
  (globalThis as Record<symbol, DiscoverListenersState>)[DISCOVER_LISTENERS_STATE_KEY] = state;
  return state;
}

function resolveListenersDirectory(): string {
  const fromCwd = join(process.cwd(), "src", "listeners");

  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  return join(import.meta.dir, "../listeners");
}

function loadDiscoveredListeners(): ListenerRegistrar[] {
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

  const listeners = entries.map((fileName) => {
    const filePath = join(listenersDirectory, fileName);
    const loaded = requireListener(filePath) as { default?: ListenerRegistrar };
    return loaded.default;
  });

  return listeners.filter(
    (listener): listener is ListenerRegistrar => typeof listener === "function",
  );
}

function discoverListeners(): ListenerRegistrar[] {
  const state = readDiscoverListenersState();

  state.appListeners ??= loadDiscoveredListeners();
  return state.appListeners;
}

function resetDiscoverListenersForTests(): void {
  const state = readDiscoverListenersState();
  state.appListeners = undefined;
}

export type { ListenerRegistrar };
export { discoverListeners, resetDiscoverListenersForTests };
