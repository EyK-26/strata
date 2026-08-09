import { BadRequestError } from "../errors/http";

interface FormDataLike {
  entries(): Iterable<[string, unknown]>;
}

async function parseFormBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    throw new BadRequestError("Expected a form submission.");
  }

  return formDataToRecord(await request.formData());
}

function formDataToRecord(formData: FormDataLike): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  return values;
}

export { formDataToRecord, parseFormBody };
