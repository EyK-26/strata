import type {
  ApiRouteContext,
  ApplicationRoutes,
  DocumentArtifactPlan,
  DocumentRenderer,
  GuardedModule,
  GuardedRoute,
  GuardedRouteMap,
  M1ApplicationOptions,
  M1FailureDiagnostic,
  M1FailureStage,
  M1StartupCleanupOutcome,
  PreparedApplicationRoutes,
  PublicArtifactEntry,
  PublicArtifactManifest,
  PublicArtifactPolicy,
  PublicArtifactResolver,
  ResolvedPublicArtifact,
  RouteDeclaration,
  WebRouteContext,
} from "@getstrata/bootstrap/m1";
import * as m1 from "@getstrata/bootstrap/m1";
import {
  collectPublicArtifactManifest,
  createPublicArtifactResolver,
  defineApplicationRoutes,
  describeM1Failure,
  getM1StartupCleanupCompletion,
  M1ConfigurationError,
  prepareDocumentArtifacts,
  startGuardedApplication,
  verifyPublicArtifactFiles,
} from "@getstrata/bootstrap/m1";

function internalExportsStayUnavailable() {
  // @ts-expect-error Method normalization remains an implementation detail.
  void m1.HTTP_METHODS;
  // @ts-expect-error Matching-shape normalization remains an implementation detail.
  void m1.routeShape;
  // @ts-expect-error Consumers use defineApplicationRoutes, not its internal validator.
  void m1.validateGuardedRoutes;
}
void internalExportsStayUnavailable;

export type PublicM1Types = [
  ApiRouteContext,
  ApplicationRoutes<unknown, "/notes/:id">,
  DocumentArtifactPlan,
  DocumentRenderer,
  GuardedModule,
  GuardedRoute,
  GuardedRouteMap,
  M1ApplicationOptions,
  M1FailureDiagnostic,
  M1FailureStage,
  M1StartupCleanupOutcome,
  PreparedApplicationRoutes,
  PublicArtifactEntry,
  PublicArtifactManifest,
  PublicArtifactPolicy,
  PublicArtifactResolver,
  ResolvedPublicArtifact,
  RouteDeclaration,
  WebRouteContext,
];

const routes = defineApplicationRoutes<{ consumer: string }>()({
  "/notes/:id": (request, server) => Response.json({ id: request.params.id, port: server.port }),
});
const application: M1ApplicationOptions<{ consumer: string }> = {
  modules: [{ name: "public-contract", routes: () => routes }],
};
void application;
void [
  collectPublicArtifactManifest,
  verifyPublicArtifactFiles,
  createPublicArtifactResolver,
  prepareDocumentArtifacts,
  startGuardedApplication,
  describeM1Failure,
  getM1StartupCleanupCompletion,
  M1ConfigurationError,
];
