import { toResourceCollection } from "../../core/http";
import type { Nemesis } from "../../types/nemesis";
import {
  toSecretResource,
  toSecretResourceCollection,
  type SecretResource,
} from "../secret/resources";

interface NemesisResource {
  id: number;
  is_alive: boolean;
  years: number;
  character_id: number;
  secrets?: SecretResource[];
}

function toNemesisResource(nemesis: Nemesis): NemesisResource {
  return {
    id: nemesis.id,
    is_alive: nemesis.is_alive,
    years: nemesis.years,
    character_id: nemesis.character_id,
    ...(nemesis.secrets
      ? { secrets: toSecretResourceCollection(nemesis.secrets) }
      : {}),
  };
}

function toNemesisResourceCollection(
  nemeses: readonly Nemesis[],
): NemesisResource[] {
  return toResourceCollection(nemeses, toNemesisResource);
}

interface NemesisTreeRecordResource {
  data: NemesisResource;
  children: {
    has_secret: {
      records: Array<{
        data: SecretResource;
      }>;
    };
  };
}

function toNemesisTreeRecordResource(
  record: Nemesis,
  secrets: readonly SecretResource[],
): NemesisTreeRecordResource {
  return {
    data: toNemesisResource(record),
    children: {
      has_secret: {
        records: secrets.map((secret) => ({ data: toSecretResource(secret) })),
      },
    },
  };
}

export {
  toNemesisResource,
  toNemesisResourceCollection,
  toNemesisTreeRecordResource,
};
export type { NemesisResource, NemesisTreeRecordResource };
