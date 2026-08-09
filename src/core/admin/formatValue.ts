import type { AdminColumnType } from "./types.ts";

function formatAdminValue(value: unknown, type: AdminColumnType = "text"): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (type === "boolean") {
    return value ? "yes" : "no";
  }

  if (type === "number") {
    return String(value);
  }

  if (type === "datetime") {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value);
  }

  if (type === "code") {
    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value, null, 2);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export { formatAdminValue };
