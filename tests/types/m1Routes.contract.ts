import type { Server } from "bun";
import { type GuardedModule, startGuardedApplication } from "../../src/bootstrap/m1/application";
import { defineApplicationRoutes } from "../../src/bootstrap/m1/guardedRoutes";

defineApplicationRoutes()({
  "/notes/:id": { GET: (request) => Response.json({ id: request.params.id }) },
});
defineApplicationRoutes()({ "/health": new Response("ok") });
defineApplicationRoutes()({ "/empty": async () => new Response() });
// @ts-expect-error Opaque native files are not guarded responders.
defineApplicationRoutes()({ "/private": Bun.file("private") });
// @ts-expect-error Every route must have at least one native method.
defineApplicationRoutes()({ "/empty": {} });
// @ts-expect-error Callback responses must be Response, not upgrade/undefined values.
defineApplicationRoutes()({ "/undefined": () => undefined });
// @ts-expect-error Non-native method keys are not accepted.
defineApplicationRoutes()({ "/bad": { get: () => new Response() } });
// @ts-expect-error Relative declaration aliases belong to the legacy API.
defineApplicationRoutes()({ alias: () => new Response() });

type ConnectionData = { userId: string };
const module: GuardedModule<ConnectionData> = {
  name: "typed",
  routes: () =>
    defineApplicationRoutes<ConnectionData>()({
      "/native/:id": (request, server) => {
        const native: Server<ConnectionData> = server;
        native.publish("room", request.params.id);
        return new Response();
      },
    }),
};
const app = startGuardedApplication<ConnectionData>({
  modules: [module],
  transport: {
    native: {
      websocket: {
        message(socket) {
          const identity: string = socket.data.userId;
          socket.send(identity);
        },
      },
    },
  },
});
void app.then(({ server }) => {
  const native: Server<ConnectionData> = server;
  return native.pendingRequests;
});
