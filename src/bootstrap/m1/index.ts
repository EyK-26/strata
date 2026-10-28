/** M1 review contract. Publication and application adoption remain separate decisions. */

export {
  type GuardedModule,
  type M1ApplicationOptions,
  type RouteDeclaration,
  startGuardedApplication,
} from "./application";
export { describeM1Failure, type M1FailureDiagnostic, type M1FailureStage } from "./diagnostics";
export {
  type ApiRouteContext,
  type ApplicationRoutes,
  type DocumentRenderer,
  defineApplicationRoutes,
  type GuardedRoute,
  type GuardedRouteMap,
  type PreparedApplicationRoutes,
  type WebRouteContext,
} from "./guardedRoutes";
export {
  collectPublicArtifactManifest,
  createPublicArtifactResolver,
  type DocumentArtifactPlan,
  type PublicArtifactEntry,
  type PublicArtifactManifest,
  type PublicArtifactPolicy,
  type PublicArtifactResolver,
  prepareDocumentArtifacts,
  type ResolvedPublicArtifact,
  verifyPublicArtifactFiles,
} from "./publicArtifacts";
export { getM1StartupCleanupCompletion, type M1StartupCleanupOutcome } from "./startupCleanup";
export { M1ConfigurationError } from "./validation";
