import {
  getQueryParams,
  parseOptionalPositiveIntQueryParam,
  parsePositiveIntParam,
} from "../../core/http";

type SecretIdParams = { id: string };
type NemesisSecretParams = { id: string };

interface SecretListQueryDto {
  limit?: number;
}

function parseSecretIdParams(params: SecretIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "secret id"),
  };
}

function parseNemesisSecretParams(params: NemesisSecretParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "nemesis id"),
  };
}

function parseSecretListQuery(request?: Request): SecretListQueryDto {
  const params = getQueryParams(request);

  return {
    limit: parseOptionalPositiveIntQueryParam(params, "limit"),
  };
}

export { parseNemesisSecretParams, parseSecretIdParams, parseSecretListQuery };
export type { NemesisSecretParams, SecretIdParams, SecretListQueryDto };
