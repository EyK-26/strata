import {
  getQueryParams,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
  parsePositiveIntParam,
} from "../../core/http";

type CharacterIdParams = { id: string };

interface CharacterListQueryDto {
  limit?: number;
  gender?: "female" | "male" | "other";
}

function parseCharacterIdParams(params: CharacterIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "character id"),
  };
}

function parseCharacterListQuery(request?: Request): CharacterListQueryDto {
  const params = getQueryParams(request);

  return {
    limit: parseOptionalPositiveIntQueryParam(params, "limit"),
    gender: parseOptionalEnumQueryParam(params, "gender", [
      "female",
      "male",
      "other",
    ]),
  };
}

export { parseCharacterIdParams, parseCharacterListQuery };
export type { CharacterIdParams, CharacterListQueryDto };
