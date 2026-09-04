import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

function optionalSalary(value: unknown) {
  if (value == null || value === "") {
    return null;
  }
  const salary = Number(value);
  if (!Number.isInteger(salary) || salary <= 0) {
    throw new ValidationError("The given data was invalid.", {
      salary: ["The salary must be a positive integer."],
    });
  }
  return salary;
}

export class CreateOfferTemplateRequest extends FormRequest<{
  name: string;
  body: string;
  salary: number | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const name = typeof body.name === "string" ? body.name : "";
    const letter = typeof body.body === "string" ? body.body : "";
    if (!name.trim()) {
      throw new ValidationError("The given data was invalid.", {
        name: ["The template name is required."],
      });
    }
    if (!letter.trim()) {
      throw new ValidationError("The given data was invalid.", {
        body: ["The template body is required."],
      });
    }
    return {
      name,
      body: letter,
      salary: optionalSalary(body.salary),
    };
  }
}

export class UpdateOfferTemplateRequest extends FormRequest<{
  name?: string;
  body?: string;
  salary?: number | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const result: { name?: string; body?: string; salary?: number | null } = {};
    if (Object.hasOwn(body, "name")) {
      result.name = typeof body.name === "string" ? body.name : "";
    }
    if (Object.hasOwn(body, "body")) {
      result.body = typeof body.body === "string" ? body.body : "";
    }
    if (Object.hasOwn(body, "salary")) {
      result.salary = optionalSalary(body.salary);
    }
    return result;
  }
}

export class FromTemplateRequest extends FormRequest<{
  template_id: number;
  salary: number | null;
  notes: string | null;
  starts_on: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const template_id = Number(body.template_id);
    if (!Number.isInteger(template_id) || template_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        template_id: ["The offer template is required."],
      });
    }
    return {
      template_id,
      salary: optionalSalary(body.salary),
      notes: typeof body.notes === "string" ? body.notes : null,
      starts_on: typeof body.starts_on === "string" ? body.starts_on : null,
    };
  }
}
