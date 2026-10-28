/** Shared declaration checks; Proxy/import side effects are outside this boundary. */
import { type M1FailureStage, recordM1Diagnostic, routeMigrationHint } from "./diagnostics";

export class M1ConfigurationError extends TypeError {
  constructor(
    readonly code: string,
    readonly field: string,
    readonly owner?: string,
    readonly stage: M1FailureStage = "validation",
  ) {
    const hint = routeMigrationHint(code, field);
    super(`M1 ${code}: ${field}${owner ? ` (${owner})` : ""}${hint ? `. ${hint}` : ""}`);
    this.name = "M1ConfigurationError";
    recordM1Diagnostic(this, { stage, code, field, owner }, true);
  }
}

export function dataRecord(value: unknown, field: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new M1ConfigurationError("invalid-record", field);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw new M1ConfigurationError("invalid-data-property", field);
    result[key] = descriptor.value;
  }
  return result;
}

export function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void {
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    throw new M1ConfigurationError("invalid-fields", field);
}

export function dataArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new M1ConfigurationError("invalid-array", field);
  const result: unknown[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw new M1ConfigurationError("invalid-array-property", field);
    result[Number(key)] = descriptor.value;
  }
  if (Object.keys(result).length !== value.length)
    throw new M1ConfigurationError("sparse-array", field);
  return result;
}

export function relativePath(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(value) ||
    value.split("/").some((part) => part === "." || part === "..")
  )
    throw new M1ConfigurationError("invalid-path", field);
  return value;
}

export function assertApprovedDestination(url: URL, origin: URL, prefix: string): void {
  if (url.origin !== origin.origin || !url.pathname.startsWith(prefix))
    throw new M1ConfigurationError("invalid-destination", "artifacts");
}
