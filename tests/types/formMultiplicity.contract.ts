import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";

const form = new FormData();
const legacy: Record<string, string> = formDataToRecord(form);
const preserved: Record<string, (string | File)[]> = formDataToRecord(form, {
  preserveRepeated: true,
});
const numeric: Record<string, number[]> = formDataToRecord(new Map([["count", 2]]), {
  preserveRepeated: true,
});
const request = new Request("http://example.test");
const parsed: Promise<Record<string, (string | File)[]>> = parseFormBody(request, {
  preserveRepeated: true,
});
void legacy;
void preserved;
void numeric;
void parsed;

const dynamic = formDataToRecord(form, { preserveRepeated: Math.random() > 0.5 });
// Files remain possible when configuration chooses preservation at runtime.
// @ts-expect-error a dynamic opt-in cannot promise string-only field arrays.
const textOnly: Record<string, string> | Record<string, string[]> = dynamic;
void textOnly;
