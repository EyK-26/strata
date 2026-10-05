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
      const details = operation as {
        parameters?: Array<{ name: string; in: string; required?: boolean }>;
      };
      const seen = new Set<string>();
      for (const parameter of details.parameters ?? []) {
        const identity = `${parameter.in}:${parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name}`;
        if (seen.has(identity))
          errors.push(`Duplicate parameter ${parameter.name} on ${method.toUpperCase()} ${path}.`);
        seen.add(identity);
        if (
          parameter.in === "path" &&
          (!parameter.required || !path.includes(`{${parameter.name}}`))
        )
          errors.push(`Path parameter ${parameter.name} must be required and match ${path}.`);
      }
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
