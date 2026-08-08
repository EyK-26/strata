import { ValidationError } from "../errors/http";

type ValidationRule = (
  field: string,
  value: unknown,
  payload: Record<string, unknown>,
) => string | undefined;

type ValidationSchema = Record<string, ValidationRule[]>;

function required(): ValidationRule {
  return (field, value) => {
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return `"${field}" is required.`;
    }

    return undefined;
  };
}

function stringRule(): ValidationRule {
  return (field, value) => {
    if (typeof value !== "string") {
      return `"${field}" must be a string.`;
    }

    return undefined;
  };
}

function minLength(minimum: number): ValidationRule {
  return (field, value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    if (value.trim().length < minimum) {
      return `"${field}" must be at least ${minimum} characters.`;
    }

    return undefined;
  };
}

function maxLength(maximum: number): ValidationRule {
  return (field, value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    if (value.trim().length > maximum) {
      return `"${field}" must be at most ${maximum} characters.`;
    }

    return undefined;
  };
}

function pattern(expression: RegExp): ValidationRule {
  return (field, value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    if (!expression.test(value.trim())) {
      return `"${field}" has an invalid format.`;
    }

    return undefined;
  };
}

function enumRule<TValue extends string>(
  allowedValues: readonly TValue[],
): ValidationRule {
  return (field, value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    if (!allowedValues.includes(value as TValue)) {
      return `"${field}" must be one of: ${allowedValues.join(", ")}.`;
    }

    return undefined;
  };
}

function optional(): ValidationRule {
  return () => undefined;
}

function integerRule(): ValidationRule {
  return (field, value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const parsed =
      typeof value === "number" ? value : Number.parseInt(String(value), 10);

    if (!Number.isInteger(parsed)) {
      return `"${field}" must be an integer.`;
    }

    return undefined;
  };
}

function emailRule(): ValidationRule {
  return (field, value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return `"${field}" must be a valid email address.`;
    }

    return undefined;
  };
}

function confirmed(fieldName: string): ValidationRule {
  return (field, value, payload) => {
    const confirmationKey = `${fieldName}_confirmation`;
    const confirmation = payload[confirmationKey];

    if (value !== confirmation) {
      return `"${field}" confirmation does not match.`;
    }

    return undefined;
  };
}

function positiveIntegerRule(): ValidationRule {
  return (field, value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const parsed =
      typeof value === "number" ? value : Number.parseInt(String(value), 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      return `"${field}" must be a positive integer.`;
    }

    return undefined;
  };
}

function integerRange(minimum: number, maximum: number): ValidationRule {
  return (field, value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const parsed =
      typeof value === "number" ? value : Number.parseInt(String(value), 10);

    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      return `"${field}" must be an integer between ${minimum} and ${maximum}.`;
    }

    return undefined;
  };
}

function validateObject(
  payload: unknown,
  schema: ValidationSchema,
): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const body = payload as Record<string, unknown>;
  const errors: Record<string, string[]> = {};
  const output: Record<string, unknown> = {};

  for (const [field, rules] of Object.entries(schema)) {
    const messages = rules
      .map((rule) => rule(field, body[field], body))
      .filter((message): message is string => message !== undefined);

    if (messages.length > 0) {
      errors[field] = messages;
      continue;
    }

    if (field in body && body[field] !== undefined) {
      const rawValue = body[field];
      output[field] =
        typeof rawValue === "string" ? rawValue.trim() : rawValue;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("The given data was invalid.", errors);
  }

  return output;
}

export {
  confirmed,
  emailRule,
  enumRule,
  integerRange,
  integerRule,
  maxLength,
  minLength,
  optional,
  pattern,
  positiveIntegerRule,
  required,
  stringRule,
  validateObject,
};
export type { ValidationRule, ValidationSchema };
