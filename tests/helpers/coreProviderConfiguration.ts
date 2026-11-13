import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
import type { ProviderContext } from "@getstrata/core/contracts/di";
import { createApplication } from "@getstrata/core/runtime/application";
import { createCacheProvider } from "../../src/bootstrap/providers/cacheProvider";
import { createConfigProvider } from "../../src/bootstrap/providers/config";

export function configured(env: Record<string, string | undefined>) {
  const configProvider = createConfigProvider(env),
    cacheProvider = createCacheProvider(env);
  const cleanups: (() => void | Promise<void>)[] = [];
  const container = new ServiceContainer(),
    config = new ConfigStore();
  const context: ProviderContext = {
    container,
    config,
    dependencies: { container },
    invoke: () => {
      throw new Error("Unexpected persistence invocation");
    },
    onCleanup: (callback) => {
      cleanups.push(callback);
    },
  };
  const app = createApplication({
    providers: [
      {
        name: "configured",
        setup: async (scope) => {
          await scope.acquire({
            name: "cache.owner",
            open: () => ({ ok: true, value: undefined }),
            close: async () => {
              for (const cleanup of cleanups.reverse()) await cleanup();
            },
          });
          await configProvider.register?.(context);
          await cacheProvider.register?.(context);
        },
      },
    ],
  });
  return { app, config, context };
}
