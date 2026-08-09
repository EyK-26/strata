export {
  type CsrfProtectionOptions,
  createCsrfProtection,
} from "@getstrata/core/http/csrfProtection";

export interface ParsedForm {
  fields: Record<string, string>;
  files: Record<string, File>;
}

export async function parseFormBody(request: Request): Promise<ParsedForm> {
  const contentType = request.headers.get("content-type") ?? "";
  const fields: Record<string, string> = {};
  const files: Record<string, File> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    for (const pair of text.split("&")) {
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const key = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, " "));
      const value = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, " "));
      fields[key] = value;
    }
    return { fields, files };
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        files[key] = value;
      } else {
        fields[key] = String(value);
      }
    }
  }

  return { fields, files };
}
