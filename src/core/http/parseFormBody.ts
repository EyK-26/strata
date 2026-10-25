import { BadRequestError } from "@getstrata/core/errors/http";

interface FormDataLike<T = unknown> {
  entries(): Iterable<[string, T]>;
}

interface FormBodyOptions {
  /** Preserve every entry as an array, including single text fields and File entries. */
  preserveRepeated?: boolean;
}

type PreservedFormValues = Record<string, (string | File)[]>;

function parseFormBody(
  request: Request,
  options: { preserveRepeated: true },
): Promise<PreservedFormValues>;
function parseFormBody(
  request: Request,
  options?: { preserveRepeated?: false },
): Promise<Record<string, string>>;
function parseFormBody(
  request: Request,
  options: FormBodyOptions,
): Promise<Record<string, string> | PreservedFormValues>;
async function parseFormBody(
  request: Request,
  options: FormBodyOptions = {},
): Promise<Record<string, string> | PreservedFormValues> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    throw new BadRequestError("Expected a form submission.");
  }

  return formDataToRecord(await request.formData(), options);
}

function formDataToRecord(
  formData: FormData,
  options: { preserveRepeated: true },
): PreservedFormValues;
function formDataToRecord<T>(
  formData: FormDataLike<T>,
  options: { preserveRepeated: true },
): Record<string, T[]>;
function formDataToRecord(
  formData: FormDataLike,
  options?: { preserveRepeated?: false },
): Record<string, string>;
// Bun currently declares FormData.entries() as string-only; retain File for dynamic flags.
function formDataToRecord(
  formData: FormData,
  options: FormBodyOptions,
): Record<string, string> | PreservedFormValues;
function formDataToRecord<T>(
  formData: FormDataLike<T>,
  options: FormBodyOptions,
): Record<string, string> | Record<string, T[]>;
function formDataToRecord<T>(
  formData: FormDataLike<T>,
  options: FormBodyOptions = {},
): Record<string, string> | Record<string, T[]> {
  if (options.preserveRepeated === true) {
    const values = new Map<string, T[]>();
    for (const [key, value] of formData.entries()) {
      const entries = values.get(key);
      if (entries) entries.push(value);
      else values.set(key, [value]);
    }
    return Object.fromEntries(values);
  }
  const values: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  return values;
}

export type { FormBodyOptions, PreservedFormValues };
export { formDataToRecord, parseFormBody };
