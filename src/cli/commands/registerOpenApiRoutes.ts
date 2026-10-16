import { type AppBootstrap, registerAppOpenApiRoutes } from "@getstrata/cli/openapi";

/** Deterministic private CLI fixture. Actual generated API/HTML contracts run in packed-app E2E. */
const bootstrapFixtureRoutes: AppBootstrap = async () => ({
  routes: {
    "/health": { GET: async () => Response.json({ status: "ok" }) },
    "/api/fixture": { GET: async () => Response.json({ fixture: true }) },
  },
});

const registerOpenApiRoutes = () => registerAppOpenApiRoutes(bootstrapFixtureRoutes);

export { bootstrapFixtureRoutes, registerOpenApiRoutes };
