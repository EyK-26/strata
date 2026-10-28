import type { BunRequest, Serve, Server } from "bun";
import type { GuardedModule } from "../../src/bootstrap/m1/application";
import { defineApplicationRoutes } from "../../src/bootstrap/m1/guardedRoutes";

type RequiresExtraProof = BunRequest<"/notes/:id"> & { frameworkHasVerifiedAdmin: true };
const requiresExtraProof = (request: RequiresExtraProof) =>
  new Response(String(request.frameworkHasVerifiedAdmin));
// @ts-expect-error The native request does not supply this application precondition.
const native: Serve.Handler<
  BunRequest<"/notes/:id">,
  Server<unknown>,
  Response
> = requiresExtraProof;
void native;
// @ts-expect-error M1 must not accept a stronger precondition than the native handler.
defineApplicationRoutes()({ "/notes/:id": requiresExtraProof });

type Data = { userId: string };
const prepared = defineApplicationRoutes<Data>()({
  "/notes/:id": {
    GET: (request, server) => {
      const id: string = request.params.id;
      const typed: Server<Data> = server;
      typed.publish("room", id);
      // @ts-expect-error Literal route inference must not admit an unrelated parameter.
      request.params.slug;
      return new Response(id);
    },
  },
});
const module: GuardedModule<Data> = { name: "typed", routes: () => prepared };
void module;
if (prepared["/notes/:id"].GET) {
  const callback: Serve.Handler<BunRequest<"/notes/:id">, Server<Data>, Response> | Response =
    prepared["/notes/:id"].GET;
  void callback;
}
const wrongData: GuardedModule<{ organizationId: string }> = {
  name: "wrong",
  // @ts-expect-error The prepared routes' server data must agree with their application.
  routes: () => prepared,
};
void wrongData;
