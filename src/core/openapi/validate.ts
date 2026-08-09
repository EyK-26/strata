import type { OpenApiSpec } from "./generator";

function validateOpenApiSpec(spec: OpenApiSpec): string[] {
  const errors: string[] = [];

  if (!spec.openapi.startsWith("3.")) {
    errors.push("OpenAPI version must be 3.x.");
  }

  if (Object.keys(spec.paths).length === 0) {
    errors.push("OpenAPI spec must include at least one path.");
  }

  for (const [path, methods] of Object.entries(spec.paths)) {
    if (!path.startsWith("/")) {
      errors.push(`Path must start with '/': ${path}`);
    }

    for (const [method, operation] of Object.entries(methods)) {
      if (!("responses" in (operation as Record<string, unknown>))) {
        errors.push(`Operation ${method.toUpperCase()} ${path} is missing responses.`);
      }
    }
  }

  if (!spec.components.securitySchemes.bearerAuth) {
    errors.push("Missing bearerAuth security scheme.");
  }

  return errors;
}

export { validateOpenApiSpec };
