import {
  FormRequest,
  parsePositiveIntParam,
} from "../../core/http";
import {
  maxLength,
  minLength,
  optional,
  required,
  stringRule,
  validateObject,
} from "../../core/validation/rules";

type TokenIdParams = { id: string };

interface CreateApiTokenBodyDto {
  name: string;
  abilities?: string[];
  expires_in_days?: number;
}

class CreateApiTokenRequest extends FormRequest<CreateApiTokenBodyDto> {
  protected parse(payload: unknown): CreateApiTokenBodyDto {
    const validated = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
      abilities: [optional()],
      expires_in_days: [optional()],
    });

    const abilities = validated.abilities;

    return {
      name: validated.name as string,
      ...(abilities === undefined
        ? {}
        : {
            abilities: Array.isArray(abilities)
              ? abilities.map(String)
              : undefined,
          }),
      ...(validated.expires_in_days === undefined
        ? {}
        : { expires_in_days: Number(validated.expires_in_days) }),
    };
  }
}

const createApiTokenRequest = new CreateApiTokenRequest();

function parseTokenIdParams(params: TokenIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "token id"),
  };
}

async function parseCreateApiTokenBody(
  request: Request,
): Promise<CreateApiTokenBodyDto> {
  return await createApiTokenRequest.validate(request);
}

export { parseCreateApiTokenBody, parseTokenIdParams };
export type { CreateApiTokenBodyDto, TokenIdParams };
