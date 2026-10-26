/** Provisional local prototype; not an approved major-version contract. */

export * from "./application";
export { describeM1Failure, type M1FailureDiagnostic, type M1FailureStage } from "./diagnostics";
export * from "./guardedRoutes";
export * from "./publicArtifacts";
export { getM1StartupCleanupCompletion, type M1StartupCleanupOutcome } from "./startupCleanup";
export { M1ConfigurationError } from "./validation";
