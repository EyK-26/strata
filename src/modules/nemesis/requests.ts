import {
  getQueryParams,
  parseOptionalBooleanQueryParam,
  parseOptionalPositiveIntQueryParam,
  parsePositiveIntParam,
} from "../../core/http";

type NemesisIdParams = { id: string };
type CharacterNemesisParams = { id: string };

interface NemesisListQueryDto {
  limit?: number;
  isAlive?: boolean;
}

function parseNemesisIdParams(params: NemesisIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "nemesis id"),
  };
}

function parseCharacterNemesisParams(params: CharacterNemesisParams): {
  id: number;
} {
  return {
    id: parsePositiveIntParam(params.id, "character id"),
  };
}

function parseNemesisListQuery(request?: Request): NemesisListQueryDto {
  const params = getQueryParams(request);

  return {
    limit: parseOptionalPositiveIntQueryParam(params, "limit"),
    isAlive: parseOptionalBooleanQueryParam(params, "isAlive"),
  };
}

export {
  parseCharacterNemesisParams,
  parseNemesisIdParams,
  parseNemesisListQuery,
};
export type { CharacterNemesisParams, NemesisIdParams, NemesisListQueryDto };
