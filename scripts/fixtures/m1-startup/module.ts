/** A normal module extension in a fresh generated app, with deliberate failure inputs. */
import type { AppModule, AppRouteMap, ServiceProvider } from "@getstrata/bootstrap/contracts";
import { acquire, current } from "./state.ts";

function provider(label: string): ServiceProvider {
  return {
    name: `owned-startup-${label}`,
    register({ onCleanup, dependencies }) {
      const attempt = current;
      const resource = acquire(attempt, label);
      onCleanup(async () => {
        attempt.events.push(`${label}.close`);
        await resource.server.stop(true);
        resource.closed++;
        if (label === "B" && ["close-failure", "native-bind-close-failure"].includes(attempt.mode))
          throw attempt.cleanupError;
      });
      onCleanup(() => {
        attempt.events.push(`${label}.flush`);
        if (label === "B" && attempt.mode === "flush-failure") throw attempt.cleanupError;
      }, "flush");
      onCleanup(() => {
        attempt.events.push(`${label}.drain`);
        if (label === "B" && ["drain-failure", "startup-drain-failure"].includes(attempt.mode))
          throw attempt.drainError;
      }, "drain");
      if (label === "B" && attempt.mode === "dependency-missing") delete dependencies.cache;
      if (label === "B" && attempt.mode === "register-failure") throw attempt.startupError;
    },
    async boot() {
      const attempt = current;
      attempt.events.push(`${label}.boot`);
      await Promise.resolve();
      if (
        label === "A" &&
        ["boot-failure", "close-failure", "flush-failure", "startup-drain-failure"].includes(
          attempt.mode,
        )
      )
        throw attempt.startupError;
    },
  };
}
const module: AppModule = {
  name: "owned-startup-probe",
  providers: [provider("A"), provider("B")],
  openApi: { "/startup-probe": { GET: { summary: "owned-startup-probe" } } },
  routes() {
    const attempt = current;
    attempt.factoryCalls++;
    const handler = () => {
      attempt.handlers++;
      if (attempt.mode === "late-handler-failure") throw attempt.startupError;
      return new Response("owned-app-handler");
    };
    const routes: AppRouteMap = { "/startup-probe": { GET: handler } };
    if (attempt.mode === "route-factory-failure") throw attempt.startupError;
    if (attempt.mode === "orphan-metadata") return {};
    if (attempt.mode === "route-getter")
      Object.defineProperty(routes, "/trap", {
        enumerable: true,
        get() {
          attempt.getters++;
          throw attempt.startupError;
        },
      });
    if (attempt.mode === "route-proxy")
      return new Proxy(routes, {
        ownKeys() {
          attempt.traps++;
          throw attempt.startupError;
        },
      });
    if (attempt.mode === "native-bad-pattern") routes["/duplicate/:id/:id"] = { GET: handler };
    return routes;
  },
};
export default module;
