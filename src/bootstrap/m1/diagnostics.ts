/** Safe diagnostics are separate from internal Error messages, stacks and causes. */
export type M1FailureStage =
  | "startup"
  | "validation"
  | "providers"
  | "collection"
  | "publication"
  | "bind"
  | "lifecycle"
  | "cleanup"
  | "request"
  | "shutdown";
export type M1FailureDiagnostic = Readonly<{
  stage: M1FailureStage;
  code: string;
  field: string;
  owner?: string;
  hint?: string;
}>;
const stages = new Set<M1FailureStage>([
  "startup",
  "validation",
  "providers",
  "collection",
  "publication",
  "bind",
  "lifecycle",
  "cleanup",
  "request",
  "shutdown",
]);
const unknownFailure: M1FailureDiagnostic = Object.freeze({
  stage: "startup",
  code: "startup-failed",
  field: "application",
});
const recorded = new WeakMap<object, { diagnostic: M1FailureDiagnostic; specific: boolean }>();
const isReference = (value: unknown): value is object =>
  value !== null && (typeof value === "object" || typeof value === "function");

export function routeMigrationHint(code: string, field: string): string | undefined {
  if (
    (field === "routes" || field === "methods") &&
    ["invalid-record", "invalid-handler"].includes(code)
  )
    return "Use a guarded file Response or an explicitly reviewed public artifact; opaque native route values are not guarded handlers.";
  return undefined;
}

/** Internal annotation preserves thrown identity. Never derive labels from raw Error properties. */
export function recordM1Diagnostic(
  error: unknown,
  diagnostic: M1FailureDiagnostic,
  specific = false,
): void {
  if (!isReference(error)) return;
  const previous = recorded.get(error);
  const source = previous?.specific
    ? {
        ...previous.diagnostic,
        stage: diagnostic.stage,
        owner: previous.diagnostic.owner ?? diagnostic.owner,
      }
    : diagnostic;
  const stage = stages.has(source.stage) ? source.stage : "startup";
  const code = /^[a-z][a-z0-9-]{0,79}$/.test(source.code) ? source.code : "startup-failed";
  const field = /^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(source.field) ? source.field : "application";
  const owner =
    source.owner &&
    /^(?:(?:api:|web:)?[A-Za-z0-9][A-Za-z0-9._-]{0,127})(?: \/ (?:(?:api:|web:)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}))?$/.test(
      source.owner,
    )
      ? source.owner
      : undefined;
  const hint = routeMigrationHint(code, field);
  recorded.set(error, {
    specific: previous?.specific || specific,
    diagnostic: Object.freeze({
      stage,
      code,
      field,
      ...(owner ? { owner } : {}),
      ...(hint ? { hint } : {}),
    }),
  });
}

export function describeM1Failure(error: unknown): M1FailureDiagnostic {
  return (isReference(error) && recorded.get(error)?.diagnostic) || unknownFailure;
}
